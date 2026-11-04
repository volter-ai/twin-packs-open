# fal customer life

Aya configures fal for her Editor account and her Scheduler slide automation. Her API-scope key permits
model inference and the Platform pricing check; both programs carry her own key. The World credential
door stands in for Aya creating that key on fal's dashboard. Images are labeled deterministic
placeholders and Aya never interprets their subject or quality.

On 14 January 2026 Aya creates a key on the dashboard and mistypes it into Editor's credential check.
Authentication is refused. She saves it correctly and Editor checks flux/dev pricing successfully. Later that day
she enables her Scheduler automation with that key. Scheduler requests a horizontal slide image and retrieves
the returned media URL for assembly into its video.

The next day a phone-oriented campaign uses a vertical slide instead. Scheduler retrieves that returned
URL for its video. On 16 January Aya calls the API directly to try an ultrawide layout with her own key; Ideogram rejects the unsupported
aspect ratio and the job is stopped. On 19 January an omitted imagePrompt field in the scheduling data causes
validation to refuse the job; no image is available for that slide. Aya disables the automation and
stops using fal for this campaign. The story has no key-revocation API: keys are managed on the dashboard.

Act mapping: creating the key uses appCredentials; the mistyped check and its retry use getPricing in the
Platform lane; each image uses post_fal_ai_ideogram_v2; the assembler follows its captured URL through
media. The unsupported ratio and missing prompt are documented input-validation refusals of the same
model operation. The final act stops the caller; it requires no vendor operation.
