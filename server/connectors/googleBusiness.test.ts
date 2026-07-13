import { describe, expect, it, vi } from "vitest";
import {
  GoogleBusinessConnector,
  GoogleBusinessConnectorError,
} from "./googleBusiness.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });

const connectorWith = (fetcher: typeof fetch) =>
  new GoogleBusinessConnector({
    getAccessToken: async () => "opaque-test-token",
    fetch: fetcher,
    accountManagementBaseUrl: "https://accounts.test/v1",
    businessInformationBaseUrl: "https://locations.test/v1",
    reviewsBaseUrl: "https://reviews.test/v4",
  });

describe("GoogleBusinessConnector", () => {
  it("separately proves authentication, account, location, and review access", async () => {
    const connector = connectorWith(vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.hostname === "accounts.test") return jsonResponse({ accounts: [{ name: "accounts/1", accountName: "Owner" }] })
      if (url.hostname === "locations.test") return jsonResponse({ locations: [{ name: "locations/1", title: "Berlin" }] })
      return jsonResponse({ reviews: [{ reviewId: "review-1", starRating: "FIVE", comment: "Excellent" }] })
    }))
    await expect(connector.probeAccess()).resolves.toEqual({
      authentication: "passed", accountAccess: "passed", locationAccess: "passed", reviewAccess: "passed",
      accountCount: 1, locationCount: 1, sampledReviewCount: 1,
    })
  })

  it("discovers every account page and exposes safe capabilities", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(init?.headers).toMatchObject({
        authorization: "Bearer opaque-test-token",
        accept: "application/json",
      });
      return url.searchParams.get("pageToken") === "accounts-next"
        ? jsonResponse({ accounts: [{ name: "accounts/2", accountName: "Second" }] })
        : jsonResponse({
            accounts: [{ name: "accounts/1", accountName: "First", type: "PERSONAL", role: "OWNER" }],
            nextPageToken: "accounts-next",
          });
    });
    const connector = connectorWith(fetcher);

    await expect(connector.listAllAccounts()).resolves.toEqual([
      expect.objectContaining({ externalId: "accounts/1", name: "First", role: "OWNER" }),
      expect.objectContaining({ externalId: "accounts/2", name: "Second" }),
    ]);
    await expect(connector.testConnection()).resolves.toMatchObject({
      status: "connected",
      identity: { externalId: "accounts/1", name: "First" },
      accountCount: 2,
      capabilities: {
        canReadFullText: true,
        canReadReplies: true,
        supportsPagination: true,
        canWriteReplies: false,
      },
    });
  });

  it("discovers location pages with the required read mask", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/accounts/123/locations");
      expect(url.searchParams.get("readMask")).toBe("name,title,storefrontAddress,languageCode");
      if (url.searchParams.get("pageToken")) {
        return jsonResponse({ locations: [{ name: "locations/2", title: "Kreuzberg" }] });
      }
      return jsonResponse({
        locations: [
          {
            name: "locations/1",
            title: "Mitte",
            languageCode: "de",
            storefrontAddress: { locality: "Berlin" },
          },
        ],
        nextPageToken: "locations-next",
      });
    });

    const locations = await connectorWith(fetcher).listAllLocations("accounts/123");
    expect(locations).toHaveLength(2);
    expect(locations[0]).toEqual({
      externalId: "locations/1",
      accountExternalId: "accounts/123",
      type: "location",
      name: "Mitte",
      metadata: { languageCode: "de", storefrontAddress: { locality: "Berlin" } },
    });
  });

  it("retrieves all review pages and normalizes text, rating-only feedback, replies, and update times", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v4/accounts/123/locations/456/reviews");
      expect(url.searchParams.get("pageSize")).toBe("50");
      if (url.searchParams.get("pageToken") === "reviews-next") {
        return jsonResponse({
          reviews: [{ reviewId: "rating-only", starRating: "TWO", createTime: "2026-02-01T00:00:00Z" }],
        });
      }
      return jsonResponse({
        reviews: [
          {
            reviewId: "written",
            starRating: "FIVE",
            comment: "Lovely team.",
            createTime: "2026-01-01T00:00:00Z",
            updateTime: "2026-01-02T00:00:00Z",
            reviewer: { displayName: "A. Customer", profilePhotoUrl: "https://images.test/a" },
            reviewReply: { comment: "Thank you.", updateTime: "2026-01-03T00:00:00Z" },
          },
        ],
        nextPageToken: "reviews-next",
      });
    });

    const reviews = await connectorWith(fetcher).fetchAllReviews({
      accountExternalId: "accounts/123",
      entityExternalId: "locations/456",
      pageSize: 50,
    });
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      provider: "google_business",
      externalReviewId: "written",
      entityExternalId: "locations/456",
      ratingValue: 5,
      ratingScale: 5,
      bodyOriginal: "Lovely team.",
      sourceCreatedAt: "2026-01-01T00:00:00Z",
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
      replyBody: "Thank you.",
      replyUpdatedAt: "2026-01-03T00:00:00Z",
      flags: { ratingOnly: false, deleted: false },
      metadata: { reviewerDisplayName: "A. Customer" },
    });
    expect(reviews[1]).toMatchObject({
      externalReviewId: "rating-only",
      ratingValue: 2,
      bodyOriginal: null,
      flags: { ratingOnly: true, deleted: false },
    });
  });

  it.each([
    [401, "AUTHORIZATION_REQUIRED"],
    [403, "CONNECTION_PERMISSION_DENIED"],
  ] as const)("maps HTTP %i to %s without exposing provider payloads", async (status, code) => {
    const secretPayload = "do-not-expose-this-provider-detail";
    const connector = connectorWith(async () => new Response(secretPayload, { status }));

    const result = await connector.testConnection();
    expect(result).toMatchObject({ status: "failed", error: { code } });
    expect(result.error?.message).not.toContain(secretPayload);
    expect(JSON.stringify(result)).not.toContain("opaque-test-token");
  });

  it("maps rate limiting and retains only safe retry metadata", async () => {
    const connector = connectorWith(
      async () => new Response("quota detail", { status: 429, headers: { "retry-after": "17" } }),
    );

    await expect(connector.listAccounts()).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 17,
    });
  });

  it.each([
    ["non-object response", []],
    ["invalid collection", { reviews: {} }],
    ["missing review identifier", { reviews: [{ starRating: "FIVE" }] }],
  ])("rejects malformed provider data: %s", async (_label, payload) => {
    const connector = connectorWith(async () => jsonResponse(payload));
    await expect(
      connector.fetchReviews({ accountExternalId: "accounts/1", entityExternalId: "locations/2" }),
    ).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });

  it("rejects repeated provider cursors rather than looping forever", async () => {
    const connector = connectorWith(async () =>
      jsonResponse({ accounts: [{ name: "accounts/1", accountName: "First" }], nextPageToken: "same" }),
    );

    await expect(connector.listAllAccounts()).rejects.toMatchObject({
      code: "MALFORMED_PROVIDER_RESPONSE",
    });
  });

  it("maps token-provider failures to authorization required without leaking the cause", async () => {
    const connector = new GoogleBusinessConnector({
      getAccessToken: async () => {
        throw new Error("refresh-token-secret");
      },
      fetch: vi.fn(),
    });

    const result = await connector.testConnection();
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "AUTHORIZATION_REQUIRED", message: "Google Business authorization is required." },
    });
    expect(JSON.stringify(result)).not.toContain("refresh-token-secret");
  });

  it("uses typed connector errors for invalid resource names and page sizes", async () => {
    const connector = connectorWith(vi.fn());
    await expect(connector.listLocations("bad-account")).rejects.toBeInstanceOf(GoogleBusinessConnectorError);
    await expect(
      connector.fetchReviews({
        accountExternalId: "accounts/1",
        entityExternalId: "locations/2",
        pageSize: 51,
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });
});
