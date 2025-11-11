# BudSense.AI Prototype

BudSense.AI is the intelligent budtender platform that blends Watson-powered strain knowledge, Certificate of Analysis (COA) guardrails, and automated reservations so every lounge guest gets clean, verified cannabis experiences. This repository ships a runnable prototype with a FastAPI backend, a Tailwind/React front-end demo, an automation flow for n8n, and brand collateral.

## Repository Layout

```
.
├── assets/
│   └── poster.svg              # Retro-futuristic marketing poster concept
├── backend/
│   ├── app.py                  # FastAPI application with prototype endpoints
│   └── requirements.txt        # Python dependencies for the backend
├── frontend/
│   └── index.html              # Standalone React + Tailwind chatbot experience
├── n8n/
│   └── flows/
│       └── auto_order.json     # Webhook → reserve → notify automation skeleton
├── .env.example                # Sample environment variables
└── README.md
```

## Features Preview

- **Strain Knowledge Engine** – `/strains/search` surfaces mock strains with terpenes, effects, COA badges, and lab report links. Swap in Watson Discovery + MongoDB Atlas to go live.
- **COA Guard** – `/ingest_coa` ingests analytes and flags any values above their limits so you can block contaminated batches.
- **Auto-Reserve Flow** – `/orders/reserve` mocks a POS hold with lounge-friendly responses, while `/notify` simulates fan-out through SMS, email, or voice.
- **Live Menu Sweep** – `/menus/nearby` and `/menus/sync` download every live dispensary menu within a 60 mile radius, ready for lounge routing and deal stacking.
- **Deal Engine & Connections** – `/lounge/deals/apply` augments menu items with the best promos while surfacing nearby lounge buddies who share your vibe.
- **Cannabis Social Graph** – `/social/feed`, `/social/posts`, `/social/buddies/match`, and `/social/daily-refresh` power a Facebook-style feed for flower drops, current smoke check-ins, and lounge meetups.
- **Funky Budtender UI** – The React demo speaks like a pro budtender, animates reserves with GSAP, and showcases lounge and automation callouts.
- **n8n Automation** – `auto_order.json` wires a webhook into the reserve endpoint and dispatches Twilio + email confirmations.
- **Branding Assets** – `assets/poster.svg` delivers a psychedelic, resale-ready poster for decks and kiosks.

## Getting Started

### Backend API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

- Health check: `GET http://localhost:8000/health`
- Strain search: `GET http://localhost:8000/strains/search?q=gelato`
- COA ingest (example payload):
  ```bash
  curl -X POST http://localhost:8000/ingest_coa \
       -H "Content-Type: application/json" \
       -d '{
         "strain_name": "Gelato 41",
         "lab_name": "SC Labs",
         "source_url": "https://labs.example.com/gelato41.pdf",
         "collected_at": "2024-01-12T12:00:00Z",
         "analytes": [
           {"name": "Pesticide XYZ", "value_ppm": 0.4, "limit_ppm": 0.2},
           {"name": "Heavy Metal ABC", "value_ppm": 0.05, "limit_ppm": 0.2}
         ]
       }'
  ```

### Frontend Demo

1. Start the backend (above) or change `window.BUDSENSE_API_BASE` inside `frontend/index.html` to an accessible endpoint.
2. Open `frontend/index.html` in a modern browser.
3. Ask for strains like “Gelato 41” or “creative sativa limonene”, then trigger the reserve flow to see the mock reservation response.
4. Explore the **Live Menus** column to sync every dispensary within 60 miles, apply lounge deals, and surface terp-aligned connections.
5. Jump into the **Lounge Buddies Social** feed to refresh daily drops, browse profiles, and match with smoking partners who share your favorites.

### n8n Flow

1. Import `n8n/flows/auto_order.json` into your n8n instance.
2. Configure credentials for your POS, Twilio, and email provider in n8n.
3. Point the webhook to your deployed API to auto-reserve and notify guests.

### Environment Variables

Duplicate `.env.example` into `.env` and populate credentials for Watson Discovery/Assistant, MongoDB Atlas, POS vendors, notification providers, live menu aggregators, and social refresh jobs before production deployment.

Key additions for the menu + social expansion:

- `DISPENSARY_MENU_API_KEY` – credential for the partner feed (Leafly, Weedmaps, Dutchie, etc.).
- `MENU_SYNC_RADIUS_MILES` – default sweep radius for menu pulls (prototype uses 60 miles).
- `SOCIAL_REFRESH_SCHEDULE` – cron or ISO8601 schedule for daily social refreshes.

## Roadmap Highlights

- Wire Watson Discovery + LangChain for nightly strain ingestion and summarization.
- Expand COA parser with LLM-assisted PDF extraction and analyte confidence scoring.
- Implement tenant-aware POS drivers (Treez, Dutchie, Meadow, Blaze) with audit trails.
- Layer in Stripe billing, loyalty analytics, and kiosk/white-label theming.
- Plug dispensary menu aggregator APIs directly into `/menus/sync` for real-time availability.
- Add real push notifications + friend graph storage for the lounge buddies network.

## License

This project is licensed under the [MIT License](LICENSE).
