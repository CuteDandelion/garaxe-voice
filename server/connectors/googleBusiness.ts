export type GoogleBusinessCapability = {
  canListAccounts: true;
  canListEntities: true;
  canReadReviews: true;
  canReadFullText: true;
  canReadReplies: true;
  supportsPagination: true;
  supportsIncrementalSync: false;
  canWriteReplies: false;
};

export type GoogleBusinessAccount = {
  externalId: string;
  name: string;
  type: string | null;
  role: string | null;
  verificationState: string | null;
};

export type GoogleBusinessEntity = {
  externalId: string;
  accountExternalId: string;
  type: "location";
  name: string;
  metadata: {
    storefrontAddress: unknown | null;
    languageCode: string | null;
  };
};

export type CanonicalConnectorReview = {
  provider: "google_business";
  externalReviewId: string;
  entityExternalId: string;
  ratingValue: number | null;
  ratingScale: 5;
  title: null;
  bodyOriginal: string | null;
  language: null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  replyBody: string | null;
  replyUpdatedAt: string | null;
  flags: {
    ratingOnly: boolean;
    deleted: false;
  };
  metadata: {
    reviewerDisplayName: string | null;
    reviewerProfilePhotoUrl: string | null;
  };
  rawPayload: unknown;
};

export type ConnectionTestResult = {
  status: "connected" | "failed";
  provider: "google_business";
  identity: { externalId: string; name: string } | null;
  accountCount: number;
  capabilities: GoogleBusinessCapability;
  error?: { code: GoogleBusinessErrorCode; message: string };
};

export type GoogleAccessProbe = {
  authentication: 'passed' | 'failed';
  accountAccess: 'passed' | 'empty' | 'failed';
  locationAccess: 'passed' | 'empty' | 'failed' | 'not_tested';
  reviewAccess: 'passed' | 'empty' | 'failed' | 'not_tested';
  accountCount: number;
  locationCount: number;
  sampledReviewCount: number;
  error?: { stage: 'authentication' | 'accounts' | 'locations' | 'reviews'; code: GoogleBusinessErrorCode; message: string };
};

export type GoogleBusinessErrorCode =
  | "AUTHORIZATION_REQUIRED"
  | "CONNECTION_PERMISSION_DENIED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_PROVIDER_RESPONSE";

export class GoogleBusinessConnectorError extends Error {
  readonly code: GoogleBusinessErrorCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: GoogleBusinessErrorCode,
    message: string,
    options: { status?: number; retryAfterSeconds?: number | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GoogleBusinessConnectorError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export type GoogleBusinessConnectorOptions = {
  getAccessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  accountManagementBaseUrl?: string;
  businessInformationBaseUrl?: string;
  reviewsBaseUrl?: string;
};

type JsonRecord = Record<string, unknown>;

const CAPABILITIES: GoogleBusinessCapability = {
  canListAccounts: true,
  canListEntities: true,
  canReadReviews: true,
  canReadFullText: true,
  canReadReplies: true,
  supportsPagination: true,
  supportsIncrementalSync: false,
  canWriteReplies: false,
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const ratingValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5) {
    return value;
  }

  if (typeof value !== "string") return null;
  const ratings: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return ratings[value] ?? null;
};

const retryAfter = (response: Response): number | null => {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

export class GoogleBusinessConnector {
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly accountManagementBaseUrl: string;
  private readonly businessInformationBaseUrl: string;
  private readonly reviewsBaseUrl: string;

  constructor(options: GoogleBusinessConnectorOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.accountManagementBaseUrl =
      options.accountManagementBaseUrl ?? "https://mybusinessaccountmanagement.googleapis.com/v1";
    this.businessInformationBaseUrl =
      options.businessInformationBaseUrl ?? "https://mybusinessbusinessinformation.googleapis.com/v1";
    this.reviewsBaseUrl = options.reviewsBaseUrl ?? "https://mybusiness.googleapis.com/v4";
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const accounts = await this.listAllAccounts();
      return {
        status: "connected",
        provider: "google_business",
        identity: accounts[0]
          ? { externalId: accounts[0].externalId, name: accounts[0].name }
          : null,
        accountCount: accounts.length,
        capabilities: CAPABILITIES,
      };
    } catch (error) {
      const mapped = this.asConnectorError(error);
      return {
        status: "failed",
        provider: "google_business",
        identity: null,
        accountCount: 0,
        capabilities: CAPABILITIES,
        error: { code: mapped.code, message: mapped.message },
      };
    }
  }

  async probeAccess(): Promise<GoogleAccessProbe> {
    let accounts: GoogleBusinessAccount[]
    try {
      accounts = await this.listAllAccounts()
    } catch (error) {
      const mapped = this.asConnectorError(error)
      const stage = mapped.code === 'AUTHORIZATION_REQUIRED' ? 'authentication' : 'accounts'
      return { authentication: stage === 'authentication' ? 'failed' : 'passed', accountAccess: 'failed', locationAccess: 'not_tested', reviewAccess: 'not_tested', accountCount: 0, locationCount: 0, sampledReviewCount: 0, error: { stage, code: mapped.code, message: mapped.message } }
    }
    if (!accounts[0]) return { authentication: 'passed', accountAccess: 'empty', locationAccess: 'not_tested', reviewAccess: 'not_tested', accountCount: 0, locationCount: 0, sampledReviewCount: 0 }
    let locations: GoogleBusinessEntity[]
    try {
      locations = await this.listAllLocations(accounts[0].externalId)
    } catch (error) {
      const mapped = this.asConnectorError(error)
      return { authentication: 'passed', accountAccess: 'passed', locationAccess: 'failed', reviewAccess: 'not_tested', accountCount: accounts.length, locationCount: 0, sampledReviewCount: 0, error: { stage: 'locations', code: mapped.code, message: mapped.message } }
    }
    if (!locations[0]) return { authentication: 'passed', accountAccess: 'passed', locationAccess: 'empty', reviewAccess: 'not_tested', accountCount: accounts.length, locationCount: 0, sampledReviewCount: 0 }
    try {
      const reviews = await this.fetchReviews({ accountExternalId: accounts[0].externalId, entityExternalId: locations[0].externalId, pageSize: 1 })
      return { authentication: 'passed', accountAccess: 'passed', locationAccess: 'passed', reviewAccess: reviews.items.length ? 'passed' : 'empty', accountCount: accounts.length, locationCount: locations.length, sampledReviewCount: reviews.items.length }
    } catch (error) {
      const mapped = this.asConnectorError(error)
      return { authentication: 'passed', accountAccess: 'passed', locationAccess: 'passed', reviewAccess: 'failed', accountCount: accounts.length, locationCount: locations.length, sampledReviewCount: 0, error: { stage: 'reviews', code: mapped.code, message: mapped.message } }
    }
  }

  async listAccounts(cursor?: string): Promise<{ items: GoogleBusinessAccount[]; nextCursor: string | null }> {
    const url = new URL(`${this.accountManagementBaseUrl}/accounts`);
    if (cursor) url.searchParams.set("pageToken", cursor);
    const payload = await this.requestJson(url);
    const rawItems = payload.accounts;
    if (rawItems !== undefined && !Array.isArray(rawItems)) {
      throw this.malformed("Google Business returned an invalid accounts collection.");
    }

    const items = (rawItems ?? []).map((item) => this.normalizeAccount(item));
    return { items, nextCursor: stringOrNull(payload.nextPageToken) };
  }

  async listAllAccounts(): Promise<GoogleBusinessAccount[]> {
    return this.collectPages((cursor) => this.listAccounts(cursor));
  }

  async listLocations(
    accountExternalId: string,
    cursor?: string,
  ): Promise<{ items: GoogleBusinessEntity[]; nextCursor: string | null }> {
    this.assertResourceName(accountExternalId, "accounts/");
    const url = new URL(`${this.businessInformationBaseUrl}/${accountExternalId}/locations`);
    url.searchParams.set("readMask", "name,title,storefrontAddress,languageCode");
    if (cursor) url.searchParams.set("pageToken", cursor);
    const payload = await this.requestJson(url);
    const rawItems = payload.locations;
    if (rawItems !== undefined && !Array.isArray(rawItems)) {
      throw this.malformed("Google Business returned an invalid locations collection.");
    }

    const items = (rawItems ?? []).map((item) => this.normalizeLocation(accountExternalId, item));
    return { items, nextCursor: stringOrNull(payload.nextPageToken) };
  }

  async listAllLocations(accountExternalId: string): Promise<GoogleBusinessEntity[]> {
    return this.collectPages((cursor) => this.listLocations(accountExternalId, cursor));
  }

  async fetchReviews(input: {
    accountExternalId: string;
    entityExternalId: string;
    cursor?: string;
    pageSize?: number;
  }): Promise<{ items: CanonicalConnectorReview[]; nextCursor: string | null }> {
    this.assertResourceName(input.accountExternalId, "accounts/");
    this.assertResourceName(input.entityExternalId, "locations/");
    const accountId = input.accountExternalId.slice("accounts/".length);
    const locationId = input.entityExternalId.slice("locations/".length);
    const url = new URL(`${this.reviewsBaseUrl}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews`);
    if (input.cursor) url.searchParams.set("pageToken", input.cursor);
    if (input.pageSize !== undefined) {
      if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50) {
        throw this.malformed("Review page size must be an integer between 1 and 50.");
      }
      url.searchParams.set("pageSize", String(input.pageSize));
    }
    const payload = await this.requestJson(url);
    const rawItems = payload.reviews;
    if (rawItems !== undefined && !Array.isArray(rawItems)) {
      throw this.malformed("Google Business returned an invalid reviews collection.");
    }

    const items = (rawItems ?? []).map((review) => this.normalizeReview(input.entityExternalId, review));
    return { items, nextCursor: stringOrNull(payload.nextPageToken) };
  }

  async fetchAllReviews(input: {
    accountExternalId: string;
    entityExternalId: string;
    pageSize?: number;
  }): Promise<CanonicalConnectorReview[]> {
    return this.collectPages((cursor) => this.fetchReviews({ ...input, cursor }));
  }

  private async requestJson(url: URL): Promise<JsonRecord> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (cause) {
      throw new GoogleBusinessConnectorError(
        "AUTHORIZATION_REQUIRED",
        "Google Business authorization is required.",
        { cause },
      );
    }
    if (!token) {
      throw new GoogleBusinessConnectorError(
        "AUTHORIZATION_REQUIRED",
        "Google Business authorization is required.",
      );
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    } catch (cause) {
      throw new GoogleBusinessConnectorError(
        "PROVIDER_UNAVAILABLE",
        "Google Business is temporarily unavailable.",
        { cause },
      );
    }

    if (!response.ok) throw this.fromResponse(response);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw this.malformed("Google Business returned invalid JSON.", cause);
    }
    if (!isRecord(payload)) throw this.malformed("Google Business returned an invalid response.");
    return payload;
  }

  private fromResponse(response: Response): GoogleBusinessConnectorError {
    if (response.status === 401) {
      return new GoogleBusinessConnectorError(
        "AUTHORIZATION_REQUIRED",
        "Google Business authorization has expired or is invalid.",
        { status: response.status },
      );
    }
    if (response.status === 403) {
      return new GoogleBusinessConnectorError(
        "CONNECTION_PERMISSION_DENIED",
        "The connected Google account cannot access this Business Profile resource.",
        { status: response.status },
      );
    }
    if (response.status === 429) {
      return new GoogleBusinessConnectorError(
        "PROVIDER_RATE_LIMITED",
        "Google Business rate limited the request. Retry later.",
        { status: response.status, retryAfterSeconds: retryAfter(response) },
      );
    }
    return new GoogleBusinessConnectorError(
      "PROVIDER_UNAVAILABLE",
      "Google Business could not complete the request.",
      { status: response.status },
    );
  }

  private normalizeAccount(value: unknown): GoogleBusinessAccount {
    if (!isRecord(value)) throw this.malformed("Google Business returned a malformed account.");
    const externalId = stringOrNull(value.name);
    const name = stringOrNull(value.accountName);
    if (!externalId?.startsWith("accounts/") || !name) {
      throw this.malformed("Google Business returned a malformed account.");
    }
    return {
      externalId,
      name,
      type: stringOrNull(value.type),
      role: stringOrNull(value.role),
      verificationState: stringOrNull(value.verificationState),
    };
  }

  private normalizeLocation(accountExternalId: string, value: unknown): GoogleBusinessEntity {
    if (!isRecord(value)) throw this.malformed("Google Business returned a malformed location.");
    const externalId = stringOrNull(value.name);
    const name = stringOrNull(value.title);
    if (!externalId?.startsWith("locations/") || !name) {
      throw this.malformed("Google Business returned a malformed location.");
    }
    return {
      externalId,
      accountExternalId,
      type: "location",
      name,
      metadata: {
        storefrontAddress: value.storefrontAddress ?? null,
        languageCode: stringOrNull(value.languageCode),
      },
    };
  }

  private normalizeReview(entityExternalId: string, value: unknown): CanonicalConnectorReview {
    if (!isRecord(value)) throw this.malformed("Google Business returned a malformed review.");
    const externalReviewId = stringOrNull(value.reviewId);
    if (!externalReviewId) throw this.malformed("Google Business returned a review without an identifier.");
    const reviewer = isRecord(value.reviewer) ? value.reviewer : {};
    const reply = isRecord(value.reviewReply) ? value.reviewReply : {};
    const bodyOriginal = stringOrNull(value.comment);
    return {
      provider: "google_business",
      externalReviewId,
      entityExternalId,
      ratingValue: ratingValue(value.starRating),
      ratingScale: 5,
      title: null,
      bodyOriginal,
      language: null,
      sourceCreatedAt: stringOrNull(value.createTime),
      sourceUpdatedAt: stringOrNull(value.updateTime),
      replyBody: stringOrNull(reply.comment),
      replyUpdatedAt: stringOrNull(reply.updateTime),
      flags: { ratingOnly: bodyOriginal === null, deleted: false },
      metadata: {
        reviewerDisplayName: stringOrNull(reviewer.displayName),
        reviewerProfilePhotoUrl: stringOrNull(reviewer.profilePhotoUrl),
      },
      rawPayload: value,
    };
  }

  private async collectPages<T>(
    fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  ): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await fetchPage(cursor);
      result.push(...page.items);
      if (!page.nextCursor) return result;
      if (seen.has(page.nextCursor)) {
        throw this.malformed("Google Business returned a repeated pagination cursor.");
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor);
    return result;
  }

  private assertResourceName(value: string, prefix: string): void {
    if (!value.startsWith(prefix) || value.length === prefix.length) {
      throw this.malformed(`Invalid Google Business ${prefix.slice(0, -1)} resource name.`);
    }
  }

  private malformed(message: string, cause?: unknown): GoogleBusinessConnectorError {
    return new GoogleBusinessConnectorError("MALFORMED_PROVIDER_RESPONSE", message, { cause });
  }

  private asConnectorError(error: unknown): GoogleBusinessConnectorError {
    return error instanceof GoogleBusinessConnectorError
      ? error
      : new GoogleBusinessConnectorError(
          "PROVIDER_UNAVAILABLE",
          "Google Business could not complete the connection test.",
          { cause: error },
        );
  }
}
