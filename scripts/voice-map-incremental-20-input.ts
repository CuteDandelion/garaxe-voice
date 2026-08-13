export type IncrementalFeedbackComment = { id: string; text: string; date: string; entity: string; sourceUrl: string }
export type IncrementalFeedbackBatch = { source: string; fileName: string; comments: IncrementalFeedbackComment[] }

export const incrementalFeedbackBatches: IncrementalFeedbackBatch[] = [
  {
    source: 'neighborhood_portal',
    fileName: 'neighborhood-portal-feedback.csv',
    comments: [
      { id: 'incremental-a01', text: 'The library hold notice arrives after the pickup shelf has already released my book.', date: '2026-05-03', entity: 'Central Library', sourceUrl: 'https://example.invalid/neighborhood/a01' },
      { id: 'incremental-a02', text: 'The weekend market map lists stall numbers but not where those stalls are on the square.', date: '2026-05-06', entity: 'Riverside Market', sourceUrl: 'https://example.invalid/neighborhood/a02' },
      { id: 'incremental-a03', text: 'The parcel locker screen is too high for me to reach from my wheelchair.', date: '2026-05-09', entity: 'North Parcel Hub', sourceUrl: 'https://example.invalid/neighborhood/a03' },
      { id: 'incremental-a04', text: 'I need a collection window for bulky waste that is narrower than an entire workday.', date: '2026-05-12', entity: 'City Collection', sourceUrl: 'https://example.invalid/neighborhood/a04' },
      { id: 'incremental-a05', text: 'Nobody knows which garden beds should be watered when the volunteer rota changes.', date: '2026-05-15', entity: 'Canal Garden', sourceUrl: 'https://example.invalid/neighborhood/a05' },
      { id: 'incremental-a06', text: 'The veterinary discharge note lists two medicines without saying which dose comes first.', date: '2026-05-18', entity: 'Harbor Vet', sourceUrl: 'https://example.invalid/neighborhood/a06' },
      { id: 'incremental-a07', text: 'I felt helpless when loud music continued through campsite quiet hours and no ranger answered.', date: '2026-05-21', entity: 'Pine Camp', sourceUrl: 'https://example.invalid/neighborhood/a07' },
      { id: 'incremental-a08', text: 'The curbside charger ended normally but never sent a receipt for the electricity session.', date: '2026-05-24', entity: 'East Charging', sourceUrl: 'https://example.invalid/neighborhood/a08' },
      { id: 'incremental-a09', text: 'Please publish pool lane closures before swimmers travel across town for a session.', date: '2026-05-27', entity: 'Civic Pool', sourceUrl: 'https://example.invalid/neighborhood/a09' },
      { id: 'incremental-a10', text: 'The food co-op scale does not explain how to subtract the weight of a reusable jar.', date: '2026-05-30', entity: 'South Food Co-op', sourceUrl: 'https://example.invalid/neighborhood/a10' },
    ],
  },
  {
    source: 'community_survey',
    fileName: 'community-service-survey.csv',
    comments: [
      { id: 'incremental-b01', text: 'Send the book pickup alert while my library hold is still available, not after it expires.', date: '2026-06-02', entity: 'Central Library', sourceUrl: 'https://example.invalid/survey/b01' },
      { id: 'incremental-b02', text: 'A visual layout showing each vendor position would make the farmers market much easier to navigate.', date: '2026-06-05', entity: 'Riverside Market', sourceUrl: 'https://example.invalid/survey/b02' },
      { id: 'incremental-b03', text: 'I would avoid the delivery lockers until the controls can be operated from a seated height.', date: '2026-06-08', entity: 'North Parcel Hub', sourceUrl: 'https://example.invalid/survey/b03' },
      { id: 'incremental-b04', text: 'Let residents choose a two-hour slot for furniture collection instead of waiting at home all day.', date: '2026-06-11', entity: 'City Collection', sourceUrl: 'https://example.invalid/survey/b04' },
      { id: 'incremental-b05', text: 'A shared watering calendar would stop volunteers from soaking one allotment twice and missing another.', date: '2026-06-14', entity: 'Canal Garden', sourceUrl: 'https://example.invalid/survey/b05' },
      { id: 'incremental-b06', text: 'I was anxious about giving my dog the tablets because the clinic instructions did not show the dosage order.', date: '2026-06-17', entity: 'Harbor Vet', sourceUrl: 'https://example.invalid/survey/b06' },
      { id: 'incremental-b07', text: 'Quiet-time complaints at the campground need an on-duty contact who actually responds overnight.', date: '2026-06-20', entity: 'Pine Camp', sourceUrl: 'https://example.invalid/survey/b07' },
      { id: 'incremental-b08', text: 'Email an itemized charging receipt as soon as an electric vehicle session finishes.', date: '2026-06-23', entity: 'East Charging', sourceUrl: 'https://example.invalid/survey/b08' },
      { id: 'incremental-b09', text: 'The aquatic centre should update its lap-lane timetable whenever a school booking closes lanes.', date: '2026-06-26', entity: 'Civic Pool', sourceUrl: 'https://example.invalid/survey/b09' },
      { id: 'incremental-b10', text: 'Show the empty-container tare step beside the bulk scale so shoppers pay only for the groceries.', date: '2026-06-29', entity: 'South Food Co-op', sourceUrl: 'https://example.invalid/survey/b10' },
    ],
  },
]
