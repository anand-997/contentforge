// lib/credentialsTemplate.ts
// The credentials.env template written into a user's folder. Shared by the
// server template route and the client storage providers so both stay in sync.

export const CREDENTIALS_TEMPLATE = `# ContentForge credentials
# Fill in your own API keys below, save this file, then reload the folder.
# These keys stay in YOUR folder and are sent to the server only to make your
# own Deepseek/OpenAI calls — they are never stored on the server.

DEEPSEEK_API_KEY=
OPENAI_API_KEY=

# Optional. Only needed if you switch models.imageEngine to "openai"
# or use image-vision OCR for the local learnings feature.
GEMINI_API_KEY=

# Optional. A Tavily web-search key (https://tavily.com) turns on live research
# grounding so posts are built from real, cite-able specifics. Leave blank to
# generate from your own material in honest general mode (no invented numbers).
TAVILY_API_KEY=

# Optional. A Dev.to API key (dev.to -> Settings -> Extensions -> DEV Community
# API Keys) enables the "Save Dev.to draft" button to push articles to your
# Dev.to account as drafts. Leave blank if you don't use it.
DEVTO_API_KEY=

# Optional. A Medium integration token enables the "Save Medium draft" button to
# push articles to your Medium account as drafts. NOTE: Medium deprecated its
# integration-token API — this works only if your account already has a token
# (Medium -> Settings -> Security and apps -> Integration tokens). Leave blank
# if you don't have one.
MEDIUM_INTEGRATION_TOKEN=

# Optional. Instagram Graph API credentials enable the "Publish to Instagram"
# button (posts the card image + caption LIVE, immediately — no draft). Requires
# an Instagram Business/Creator account linked to a Facebook Page, a Meta app
# with instagram_content_publish, a long-lived access token, and the IG
# professional account id. Leave blank if you don't use it.
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_USER_ID=

# Optional. LinkedIn credentials enable the "Post to LinkedIn" button (posts the
# card image + body LIVE, immediately, with hashtags as the first comment — no
# draft). Create a LinkedIn Developer app, add the "Share on LinkedIn" + "Sign In
# with OpenID Connect" products, then Auth -> OAuth 2.0 tools -> Generate token
# with scopes w_member_social, openid, profile. LINKEDIN_USER_ID (your member
# "sub") is only needed if the token lacks openid/profile. Leave blank if unused.
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_USER_ID=
`;

export const CREDENTIALS_FILENAME = "credentials.env";
export const WORKBOOK_FILENAME = "content_calendar.xlsx";
export const IMAGES_DIRNAME = "images";
