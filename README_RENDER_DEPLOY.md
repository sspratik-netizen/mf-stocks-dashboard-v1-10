# Render deployment

This package is prepared for Render as a Node.js Web Service.

## GitHub
Upload the CONTENTS of this folder to the root of your GitHub repository. `package.json` must be in the repository root.

## Render
- Service: Web Service
- Runtime: Node
- Branch: main
- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`
- Plan: Free
- Health Check Path: `/health`

The server listens on `0.0.0.0` and uses Render's `PORT` environment variable.

No application environment variables are required by the current server code.
