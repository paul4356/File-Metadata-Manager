# File Metadata Manager

A tiny React + Node workshop app for keeping file metadata. It stores filenames, sizes, and content types—not file contents. MiniMoth generates and verifies phone OTPs, delivering each by WhatsApp first and SMS fallback.

## Requirements

- Node.js 22.13+ and npm
- A MiniMoth project API key

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set `MINIMOTH_API_KEY` to the API key from MiniMoth Project Settings.
2. Copy `frontend/.env.example` to `frontend/.env`. `VITE_API_URL` can stay empty for local development.
3. In one terminal:

   ```sh
   cd backend
   npm install
   npm run dev
   ```

4. In another terminal:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

5. Open the Vite URL, usually `http://localhost:5173`. Enter an Indian mobile number in international format, such as `+919876543210`.

The frontend sends OTP requests to the backend. The backend calls MiniMoth's documented `POST https://api.minimoth.dev/v1/otp/send` and `POST https://api.minimoth.dev/v1/otp/verify` endpoints using the `X-Api-Key` header. MiniMoth generates and checks the code; its Auth0 hook and Auth0 setup are not required for this direct API flow.

The backend creates `backend/metadata.sqlite` on first start and listens on port `3001`. Vite proxies `/api` to it during development. Local app sessions end when the backend restarts. The optional MiniMoth delivery-status endpoint and refresh-token flow are not included.

## API

- `POST /api/auth/otp` — request an OTP for a phone number
- `POST /api/auth/verify` — verify the six-digit code and start a local session
- `GET /api/files` — list the signed-in user's metadata
- `POST /api/files` — add metadata (`filename`, `sizeBytes`, `contentType`)
- `DELETE /api/files/:id` — delete one of the signed-in user's metadata records
