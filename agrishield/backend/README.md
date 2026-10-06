# Backend setup

1. Copy `.env.example` to `.env` in this directory. Configure separate Admin
   service accounts for Project A (private identity and ownership) and Project B
   (application data). Keep both private keys in `backend/.env` only; never
   commit or log them.
2. Install dependencies and start the backend:

   ```powershell
   npm install
   npm start
   ```

The backend verifies Firebase ID tokens with Project A and accesses Project A
private records and Project B application records through separately named
Firebase Admin apps. Set `PRIVATE_FIREBASE_PROJECT_ID`,
`PRIVATE_FIREBASE_CLIENT_EMAIL`, and `PRIVATE_FIREBASE_PRIVATE_KEY` (or
`PRIVATE_FIREBASE_CREDENTIALS_FILE`) for Project A. Project A currently retains
the existing Firebase identity project and UID pool `agrisheild-22749`. MSG91
replaces only the SMS challenge; it does not migrate Firebase users.
Set `APP_FIREBASE_PROJECT_ID`,
`APP_FIREBASE_CLIENT_EMAIL`, and `APP_FIREBASE_PRIVATE_KEY` (or
`APP_FIREBASE_CREDENTIALS_FILE`) for Project B (`agrishield-61486`). Service
account keys must belong to the configured project. The legacy `FIREBASE_*`
variables remain supported for Project A only while local deployments
transition.

Check `/api/health` and `/api/system/status` for `firebase.projectA` and
`firebase.projectB` (or their `status.firebaseAdmin` counterparts), which report
Admin/auth configuration and Firestore configured/connected states separately.
Firestore connectivity checks perform lightweight reads of health document
paths; they do not create collections or write data. `ollamaStatus` reports the
local AI provider separately. Missing Project B credentials are reported as an
`APP_FIREBASE_*` configuration error; do not put Admin credentials in the
frontend environment.

Notification-list queries use the composite indexes in
`firestore.indexes.json`. Deploy them with the Firebase CLI from this directory
after selecting the configured Firebase project:

```powershell
firebase deploy --project agrishield-61486 --only firestore:indexes --config firebase.json
```

Project A stores `users/{uid}` and ownership metadata at
`users/{uid}/farms/{farmId}`. Project B stores operational `farms`,
farm-scoped `aiConversations`, `notifications`, `cropProtocols`,
`farmActivities`, `shopItems`, and support/feedback records. Every farm-scoped
request derives UID from the verified Project A token and checks both private
ownership metadata and the Project B `ownerUid` before reading or writing.
Active farm selection is persisted on the Project A user record.

No historical records are deleted by the Firebase split. The legacy Project A
scan found one farm with a `userId` matching an existing user document; it is a
candidate for an explicit migration after Project B credentials are configured.
Two legacy `aiConversations` records have user ownership but no `farmId`, and 33
legacy `conversations` records lack an unambiguous farm scope; do not migrate
those into farm-specific history without a reviewed mapping. No migration was
applied, and source documents remain unchanged.

## Crop Schedule and Shop Data

The schedule and catalogue are driven by Firestore records; the application
does not seed example agronomic protocols or products.

- `cropProtocols` uses a normalized crop key as its document ID, optionally
  followed by `-<normalized-variety>`. Each enabled document has `enabled:
  true`, `stages` (`name`, inclusive `startDay` and `endDay`), and `activities`
  (`id`, `name`, `dayAfterStart`, with optional `stage`, `type`,
  `productCategory`, and `productQuery`). Variety-specific protocols may set
  `variety`; otherwise the crop-level document is used.
- `farmActivities` stores the farmer and farm IDs, crop and activity IDs,
  `scheduledDate` (`YYYY-MM-DD` in the farmer's configured timezone), status
  (`COMPLETED`, `NOT_YET`, or `SKIPPED`), completion time, and update time.
  The backend derives the farm owner from the verified Firebase token.
- `shopItems` records support `productName`, normalized `category` (`seed` or
  `fertilizer`), brand, crop/variety/stage arrays, pack size, price and
  currency, `priceUpdatedAt`, image URL, supplier contact/location details,
  availability, description, and `active`. Only active seed and fertilizer
  records are returned. The Shop does not create orders or process payments.

Configure these records through a trusted Firestore administration workflow.
The public farmer API does not provide protocol or product write operations.

## MSG91 OTP and Firebase Identity

AgriShield phone verification is performed by **MSG91 OTP**. The authenticated
AgriShield identity remains **Firebase Authentication in Project A
(`agrisheild-22749`)**. The backend verifies the phone through MSG91, then
creates or looks up the Firebase user by the MSG91-approved E.164 phone number,
issues a Firebase custom token, and the existing Firebase Web SDK signs in with
`signInWithCustomToken()`. Subsequent application requests continue to send
Firebase ID tokens, which Project A Admin verifies with `verifyIdToken()`.
Firebase UID remains the owner key for private data, farms, and Project B
authorization; MSG91 is not an identity store or application database.

Configure these **backend-only** variables in `backend/.env`:

```dotenv
OTP_PROVIDER=msg91
MSG91_AUTHKEY=
MSG91_TEMPLATE_ID=
MSG91_OTP_TIMEOUT_MS=10000
```

Create and approve an OTP template in the MSG91 dashboard; its ID is required
by the MSG91 SendOTP API. The backend sends the Authkey in server-to-server
requests only. The integration follows MSG91's official
[SendOTP](https://docs.msg91.com/otp/sendotp),
[Verify OTP](https://docs.msg91.com/otp/verify-otp), and
[Resend OTP](https://docs.msg91.com/otp/resend-otp) APIs. Never add MSG91
credentials to frontend environment variables, React code, public assets, logs,
or source control. `POST /api/auth/otp/start`
starts an SMS verification, `POST /api/auth/otp/resend` resends the active OTP,
and `POST /api/auth/otp/verify` accepts the phone number and code. Only an
explicit MSG91 success response proceeds to Firebase. The backend reuses an
existing Firebase UID by phone number (or creates a Firebase Auth user), writes
the private account record only after successful verification, and returns a
Firebase custom token. No client-supplied UID is accepted. The browser signs in
with that token and the existing `/api/auth/bootstrap` flow loads the Project A
profile, owned farms, and active farm.

Phone numbers are normalized and validated as E.164 on the backend using
`libphonenumber-js`; the login form lets farmers set a country calling code,
with India `+91` as the convenient initial value.
Default abuse controls are three SMS starts per phone per 15 minutes with a
30-second resend cooldown, ten starts per IP per 15 minutes, six checks per
phone per ten minutes, and twenty checks per IP per ten minutes. Adjust the
`OTP_*` environment variables to fit the deployment's abuse policy. Limits
are process-local; deployments with multiple backend instances should also
enforce shared rate limits at a trusted gateway. Expired, invalid, exhausted,
and provider-failure outcomes never issue Firebase custom tokens.

In production, all OTP, reauthentication, and phone-change endpoints require
HTTPS. When TLS terminates at one trusted reverse proxy, set `TRUST_PROXY=1`
only if that proxy overwrites forwarded-protocol headers. Set frontend
`VITE_API_BASE_URL` and backend `CORS_ALLOWED_ORIGINS` to the real HTTPS
deployment endpoints; the checked-in localhost values are development-only.
Production startup rejects missing, wildcard, local, or plain-HTTP CORS origins.
Firebase Web App configuration
(`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`, and
`VITE_FIREBASE_MESSAGING_SENDER_ID`) must still belong to Project A. Firebase
Admin credentials remain server-side.

Sensitive account-deletion reauthentication also uses MSG91 OTP and then
signs the same Firebase UID in with a fresh custom token; the deletion route
continues to require a recent Firebase-authenticated session. Changing a
verified phone number requires an authenticated Firebase identity plus an
approved MSG91 verification, and updates that same Firebase Auth user. Neither
flow accepts a client-declared verified state or changes provider metadata to
pretend MSG91 is Firebase Phone Auth.

Firebase Dynamic Links shut down on August 25, 2025. The legacy features
affected were email-link authentication for mobile apps and Cordova OAuth
support for web apps. The pre-shutdown notice read: “The following
Authentication features will stop working when Firebase Dynamic Links shuts
down soon: email link authentication for mobile apps, as well as Cordova OAuth
support for web apps.” This web MSG91 OTP/custom-token flow does not depend on
Dynamic Links. Normal web email action handling is not affected by that
shutdown.

This code change switches the active persistence layer; it does not copy
historical database records. Export/import existing data separately if those
records must be retained.

## Weather and Farm Twin

Weather forecasts are retrieved from Open-Meteo using the saved farm
coordinates. The `/api/weather` response includes a nearby point-forecast
sample labeled "Forecast rain around your farm"; it is not radar imagery.
Open-Meteo is cached for five minutes. Historical daily agroclimate is retrieved
No historical weather source, official warning dataset, or government
agriculture dataset is integrated. Recent radar frames can be loaded from the
public RainViewer API when available; radar tiles are separate from the
Open-Meteo forecast. No weather values are fabricated when data or a saved
location is unavailable.

The farm timezone is taken from a valid saved timezone or resolved from the
saved coordinates. Farm saves persist that resolved timezone, and the Farm Twin
continues to return it when weather is unavailable. Open-Meteo receives the
resolved timezone and its response normalizes current cloud layers, wind, solar
radiation, sunrise, sunset, daylight duration, moonrise, moonset, and phase when
supplied. Its Three.js sun and moon positions are calculated from the saved farm
coordinates and current time with SunCalc. Cloud drift is an expected
visualization based on forecast wind direction, not observed satellite cloud
tracking. Weather effects are omitted when the response is missing or older than
the Farm Twin freshness window.

The Farm Twin reports `weather_data` when current weather is available,
`geometry_only` when saved farm geometry exists without current weather, and
`unavailable` when neither weather nor usable farm geometry is available.

General agricultural questions continue to use the configured AI provider and
the farmer/farm context that is available.

Authenticated AI chat, image analysis, and Live Voice use the shared backend
context builder in `services/contextService.js`. The active farm is resolved
from the authenticated UID's Project A `activeFarmId`; a supplied farm header
or route ID must match that active selection and be owned by the UID before
Project B data can be read. If the stored selection is invalid, recovery is
allowed only when the user has exactly one owned farm; multi-farm accounts must
select one explicitly. Context is rebuilt for each request and
contains only the fields relevant to its detected intent; Open-Meteo is
queried only when the question needs current weather, and crop activities or
alerts are loaded only for relevant questions. User-provided conversation
claims remain separate from authoritative stored farm values. Authenticated
chat history is loaded by UID, farm ID, and conversation ID; client-supplied
history is not trusted. General conversation requests do not add farm profile
data to the model prompt. Development responses include context-category
diagnostics without exposing profile details, credentials, or tokens.
Requests without a valid stored active farm do not silently fall back to the
first or oldest owned farm. The image provider retries transient Gemini 503/504
failures at most twice and then returns `IMAGE_ANALYSIS_UNAVAILABLE`; it does
not synthesize an analysis or switch image bytes to another provider.

## Gemini, Speech, and Live Voice

### Private AI crop-image attachments

Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` only in the backend environment. AI crop images are
streamed to Cloudinary as authenticated assets under
`CLOUDINARY_AI_FOLDER/{verifiedUid}/{activeFarmId}/{conversationId}/{messageId}`;
the default base folder is `agrishield/ai-images`. The browser sends one
authenticated multipart request to the existing AI chat endpoint, and the
backend validates the image and active-farm authorization before storage or
Gemini processing. Gemini receives the original validated image bytes and MIME
type, not a Cloudinary URL.

Firebase conversation messages store only Cloudinary attachment metadata and
the verified owner/farm/conversation association. Conversation reads verify
that association before generating a signed authenticated-delivery URL.
Transient Gemini image-analysis failures retain the uploaded asset, mark the
message `FAILED`, and can be retried through the owner- and farm-scoped retry
route without another upload. Account deletion attempts to remove only
authenticated assets beneath that UID's AI-image prefix; cleanup failures are
logged without exposing credentials or blocking account deletion. The
`cloudinary` and image-analysis status entries report configuration and
last-known reachability without returning Cloudinary credentials.

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` in the backend environment to use
Gemini as the primary text provider. The key is server-only; never put it in a
`VITE_` variable, frontend bundle, status response, or Firestore record. Text
uses `GEMINI_TEXT_MODEL` (default `gemini-2.5-flash`); image requests always use
Gemini through `GEMINI_VISION_MODEL` and are never sent to Ollama. A transient
Gemini text-service failures are reported after bounded retries; responses are
never silently replaced with Ollama output. Ollama remains available only when
explicitly selected as the configured provider for development.

Normal voice-note transcription uses ElevenLabs Scribe v2
(`ELEVENLABS_STT_MODEL`) and speech playback uses ElevenLabs Eleven v3
(`ELEVENLABS_TTS_MODEL`). Configure the backend-only `ELEVENLABS_API_KEY` and
the per-language voice IDs `ELEVENLABS_TTS_EN_VOICE_ID`,
`ELEVENLABS_TTS_HI_VOICE_ID`, and `ELEVENLABS_TTS_TE_VOICE_ID`. The centralized
language registry maps English (`en`), Hindi (`hi`), and Telugu (`te`) provider
codes alongside the app locales (`en-IN`, `hi-IN`, `te-IN`) for recognition,
Gemini response language, and synthesis. Auto STT omits a forced provider
language so Scribe can detect the spoken language. Browser recordings are
capped by `VOICE_MAX_RECORDING_SECONDS` (default 60 seconds), and uploads have
a separate size limit.

ElevenLabs credentials and voice IDs are never sent to the frontend or returned
in status responses. `/api/health`, `/api/system/status`, and
`/api/voice-config` report configured provider/model and last-known reachability
independently for STT and TTS. Audio payloads are returned to the browser and
cached by authenticated UID and active farm; transcripts, rather than raw
recordings, enter chat history. Gemini Live remains a separate Gemini Live
flow.

Gemini Live Voice is separate from chat and voice notes. Set
`GEMINI_LIVE_ENABLED=true`, configure `GEMINI_LIVE_MODEL` and the backend-only
Gemini key, and set `GEMINI_LIVE_MAX_MINUTES` (default 30). The authenticated
`POST /api/ai/live-token` route verifies the selected farm, chooses the
language/context/model server-side, and issues a single-use ephemeral token.
The long-lived Gemini key is never returned to the browser. The browser closes
the socket and releases microphone/audio resources when Live Voice ends, the
farm changes, or the chat unmounts.

The setup is diagnosed without exposing credentials through `/api/health` and
`/api/system/status`. Responses report Project A, Project B, Gemini, Gemini
Live, STT, and TTS separately, along with configured/valid status for each
language voice. Missing credentials or disabled Cloud APIs cause explicit
service errors; normal text chat, image selection, and voice-note controls do
not use browser SpeechRecognition or SpeechSynthesis as a production fallback.
