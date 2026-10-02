# Backend setup

1. Copy `.env.example` to `.env` in this directory and configure the Firebase
   Admin project ID, client email, and private key using the existing service
   account. Keep the private key in `backend/.env` only; never commit or log it.
2. Install dependencies and start the backend:

   ```powershell
   npm install
   npm start
   ```

The backend uses Firebase Admin Firestore. Check
`/api/system/status` for `firebaseAdminConfigured`, `firestoreConfigured`, and
`firestoreConnected`. Firestore connectivity is checked with a lightweight read
of a non-existent health document. A successful check does not create a
collection or write data.

Notification-list queries use the composite indexes in
`firestore.indexes.json`. Deploy them with the Firebase CLI from this directory
after selecting the configured Firebase project:

```powershell
firebase deploy --only firestore:indexes --config firebase.json
```

Firestore collections include `users`, `farms`, `aiConversations`,
`notifications`, `cropProtocols`, `farmActivities`, and `products`; support and
feedback submissions are also persisted in Firestore. Farmer-owned API calls
continue to require a verified Firebase ID token.

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
- `products` records support `productName`, normalized `category` (`seed` or
  `fertilizer`), brand, crop/variety/stage arrays, pack size, price and
  currency, `priceUpdatedAt`, image URL, supplier contact/location details,
  availability, description, and `active`. Only active seed and fertilizer
  records are returned. The Shop does not create orders or process payments.

Configure these records through a trusted Firestore administration workflow.
The public farmer API does not provide protocol or product write operations.

## Firebase Phone Authentication

Both local development and production use the Firebase Web SDK phone flow:
`RecaptchaVerifier` → `signInWithPhoneNumber` → `ConfirmationResult.confirm`.
For development, enter a fictional phone number and verification code
configured under **Firebase Console → Authentication → Phone numbers for
testing**. The app does not hard-code or request those test values, and this
flow does not send an SMS for a configured fictional number. Real Indian
numbers use Firebase SMS and the configured SMS region policy.

Before testing, verify in Firebase Console that Phone sign-in is enabled, the
SMS region policy permits India for real SMS, and `localhost` (or the deployed
host) is an authorized domain. The frontend `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`,
and `VITE_FIREBASE_MESSAGING_SENDER_ID` must all come from the intended Firebase
Web App in the same project as backend `FIREBASE_PROJECT_ID`. Keep the web API
key in the frontend environment and the Admin private key only in
`backend/.env`.

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

The Farm Twin reports `weather_data` when current weather is available,
`geometry_only` when saved farm geometry exists without current weather, and
`unavailable` when neither weather nor usable farm geometry is available.

General agricultural questions continue to use the configured AI provider and
the farmer/farm context that is available.
