# Run locally on Windows / Mac / Linux

## Requirements
- Install **Node.js 18 or newer** (Node.js 20 or 22 LTS is recommended).
- Internet access is required when the dashboard fetches live mutual-fund and market data.

## Windows (PowerShell)
Open PowerShell in this project folder and run:

```powershell
npm install
npm start
```

Then open:

`http://localhost:3000`

To stop the server, press `Ctrl + C`.

## Development mode

```powershell
npm run dev
```

This restarts the server when `server.js` changes.

## Mac / Linux

```bash
npm install
npm start
```

Then open:

`http://localhost:3000`

## If port 3000 is already in use

### Windows PowerShell

```powershell
$env:PORT=3001
npm start
```

Open `http://localhost:3001`.

### Mac / Linux

```bash
PORT=3001 npm start
```

## Important
Do not open the HTML files directly by double-clicking them. Start the Node.js server with `npm start`, then open the localhost address in your browser.
