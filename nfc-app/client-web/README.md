# Restaurant Menu — GitHub Pages Deployment

This is the mobile client (phone menu) for the Restaurant NFC ordering system,
packaged for static hosting on GitHub Pages.

## How It Works

The menu reads configuration from URL query parameters:

```
https://<your-username>.github.io/<repo-name>/?server=https://your-backend.onrender.com&table=5
```

| Param    | Description                                       | Example                              |
|----------|---------------------------------------------------|--------------------------------------|
| `server` | Full URL of your Express backend (no trailing `/`) | `https://my-restaurant.onrender.com` |
| `table`  | Table/module ID to load the menu for              | `5`                                  |

## Deploy to GitHub Pages

### 1. Create a GitHub repository

```bash
cd client-web
git init
git add .
git commit -m "Initial commit — restaurant mobile menu"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Under **Source**, select **Deploy from a branch**
3. Branch: `main`, Folder: `/ (root)`
4. Click **Save**

Your site will be live at: `https://<your-username>.github.io/<repo-name>/`

### 3. Update NFC tags

The ESP32 NFC URL should now point to:

```
https://<your-username>.github.io/<repo-name>/?server=https://your-backend.onrender.com&table=<TABLE_ID>
```

## Backend Requirements

Your Express backend must have:
- **CORS enabled** for `*` or your GitHub Pages origin (already configured)
- Be accessible over **HTTPS** (Render, Railway, etc. provide this automatically)

If the backend is running locally (e.g., `http://192.168.1.x:3001`), this will **not work**
from GitHub Pages due to mixed-content blocking (HTTPS → HTTP). For local development,
use the original `client/` folder served by Express.

## Local Testing

You can test locally with any static file server:

```bash
npx serve .
# Then open: http://localhost:3000/?server=http://localhost:3001&table=1
```

This works because localhost HTTP → localhost HTTP has no mixed-content issue.

## File Structure

```
client-web/
├── index.html   ← Entry point
├── style.css    ← All styling (identical to client/style.css)
├── app.js       ← Logic with configurable backend URL
└── README.md    ← This file
```
