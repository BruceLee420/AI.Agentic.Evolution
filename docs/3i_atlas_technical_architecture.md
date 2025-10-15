# 3i/Atlas Technical Architecture

## Overview
The 3i/Atlas system is composed of three tiers:
1. **Data Intelligence Layer** – Pipelines that harvest, normalize, and enrich scholarly and telemetry data. Built in TypeScript + Node.js, orchestrated by n8n.
2. **AI Analytics Layer** – A trio of AI services for orbit forecasting, document insight extraction, and visual storytelling. Implemented with Python microservices, huggingface models, and GPU-enabled inference endpoints.
3. **Experience Layer** – A React Native Android application with cyberpunk UI/UX and offline-first capabilities, plus supporting cloud functions for push notifications and the badge generator.

```
┌─────────────────────────────────────────────────────────────┐
│                        Experience Layer                      │
│  - React Native Android app                                  │
│  - Badge/Icon generator micro-frontend                       │
│  - Screensaver & visualization renderer (Three.js + Expo)    │
└───────────────▲─────────────────────────────────────────────┘
                │ GraphQL + WebSocket API
┌───────────────┴─────────────────────────────────────────────┐
│                   AI Analytics Layer                         │
│  - OrbitAI: physics-informed transformer                     │
│  - TrajectoryRL: reinforcement learning Monte Carlo sim      │
│  - ConsensusAI: Kalman fusion + explanation engine           │
│  - Sora-Style Diffusion: cyberpunk image generator           │
│  - Quote Curator: semantic search across curated corpus      │
└───────────────▲─────────────────────────────────────────────┘
                │ Async events (Kafka) + REST hooks
┌───────────────┴─────────────────────────────────────────────┐
│                  Data Intelligence Layer                     │
│  - Feed connectors (NASA, ESA, arXiv, institutional repos)   │
│  - PDF downloader & OCR                                      │
│  - Metadata normalizer (Dublin Core / schema.org)            │
│  - Storage: PostgreSQL + S3-compatible object store          │
│  - n8n automation for self-updating pipelines                │
└─────────────────────────────────────────────────────────────┘
```

## Key Components
### 1. Data Connectors
- **NASA NeoWs & ADS** via REST.
- **ESA Space Situational Awareness** via RSS/REST.
- **University Papers** via arXiv API + OAI-PMH harvesters.
- **State Agency Feeds** via RSS, JSON, and CSV endpoints.
- **Amateur Imagery** via AstroBin API and NASA APOD archives.
- **Hubble Telemetry** via Space Telescope Science Institute APIs.

Connectors share a common interface defined in TypeScript with retry, caching, and provenance tagging.

### 2. Data Lake & Catalog
- **PostgreSQL** stores normalized metadata, authorship, tags, and cross-references.
- **MinIO/S3** bucket stores PDFs and images with checksum verification.
- **ElasticSearch** index supports full-text search and geospatial queries.
- **TimescaleDB** extension captures orbital telemetry time-series.

### 3. AI Services
- **OrbitAI**: physics-informed transformer that ingests TLE data and propagates orbits forward 7 days. Returns predicted position, velocity, and uncertainty cones.
- **TrajectoryRL**: reinforcement learning agent that simulates orbital adjustments with Monte Carlo runs for anomaly detection.
- **ConsensusAI**: Kalman filter-based service that reconciles predictions from OrbitAI, TrajectoryRL, and raw telemetry to produce consensus trajectories and explainability logs.
- **DocSynth**: LLM-powered summarizer that extracts key findings from PDFs, tagging whether conclusions align with observational data.
- **SoraCanvas**: diffusion model fine-tuned on cyberpunk astronomical art to generate daily “Sora” images.

### 4. Experience Layer Modules
- **Universe Command Center**: Three.js scene with dynamic lighting, cyberpunk shaders, and orbit visualizations. Auto-zooms to 3i/Atlas on a timer to display live stats.
- **Daily Spotlight Screen**: Highlights one hypothesis/viewpoint and walks users through evidence for/against accuracy.
- **Screensaver Mode**: Idle mode loops through panoramic space vistas; clicking a planet reveals orbit path, historical events, and toggles to telescope imagery.
- **Badge Studio**: Users customize and export the glowing green 3i badge/icon as PNG/WebP; integration with Android share sheet.
- **Pricing & Monetization**: In-app purchase flow for $0.99 unlock via Google Play Billing Library.

### 5. Automation & Self-Improvement
- n8n orchestrates feed refresh, anomaly detection alerts, model retraining triggers, and Play Store asset regeneration.
- GitOps pipeline monitors repository changes and triggers CI/CD using GitHub Actions + Fastlane for Play Store deployment.
- Telemetry-based auto-tuning updates AI service hyperparameters when prediction error exceeds thresholds.

## Data Flow
1. **Ingest**: n8n triggers connectors hourly, fetching new documents, telemetry, and imagery.
2. **Normalize**: Metadata is standardized; PDFs stored; text extracted for NLP.
3. **Analyze**: AI services generate summaries, accuracy scores, and trajectory predictions.
4. **Publish**: GraphQL API exposes aggregated views; WebSocket streams push live telemetry to the app.
5. **Experience**: Android client renders orbit scene, daily content, and notifications.

## Security & Compliance
- OAuth2 service accounts for agency APIs.
- Signed URLs for sensitive PDFs; enforce DRM when required.
- TLS 1.3 for all network traffic.
- PII minimization; only collect user telemetry necessary for personalization.
- Store audit trails of data provenance for academic integrity.

## Observability
- Prometheus metrics for connector health and AI latency.
- Grafana dashboards for orbit prediction accuracy and pipeline throughput.
- Sentry integration for client crash analytics.

## Roadmap Milestones
1. **MVP** – NASA + arXiv ingestion, orbit visualization prototype, daily quote/image generation.
2. **Beta** – Additional agency feeds, AI consensus model, Play Store closed testing.
3. **v1 Launch** – Full badge studio, screensaver, $0.99 pricing, marketing assets.
4. **Post-Launch** – Continuous self-improvement via n8n, user feedback loops, extended telescope integrations.

_Designed by Adrian Andrew Grimaldo_
