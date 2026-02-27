# Leroboscope

Browser-based MuJoCo dataset replay viewer for [LeRobot](https://github.com/huggingface/lerobot) datasets.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

## Getting Started

```bash
npm install
npm run dev
```

This starts a local Vite dev server (typically at `http://localhost:5173`).

## URL Parameters

You can link directly to a specific dataset and episode:

```
http://localhost:5173/?dataset=danbhf/sim_pick_place_2pos_200ep_v2&episode=5
```

When a `?dataset=` param is present, the landing page is skipped automatically.

## Build

```bash
npm run build
npm run preview   # preview the production build locally
```
