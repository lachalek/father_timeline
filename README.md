## Father Timeline

A Reddit game. One historical event starts on the line. Each round, drag the next event into a gap — before, after, or between the cards already placed. A right gap scores +1. A wrong gap scores −1, and the event still lands on its true year so the line stays honest.

Events and births come from Wikipedia's [On this day](https://en.wikipedia.org/api/rest_v1/#/Feed/onThisDay) feed. A game starts by choosing a difficulty. Easy keeps pages with at least a million views a year, medium keeps 100,000 up to one million, and hard keeps 10,000 up to 100,000. The opening hand is one day's sample. More cards load while the first round is underway. Counts are a year-pace from the latest 60 days of pageviews, which Wikipedia can return for many pages in one request.

## Fetch Domains

The following domains are requested for this app:

- `en.wikipedia.org` — Loads dated historical events and births from the public On this day REST feed (`/api/rest_v1/feed/onthisday`), and loads pageviews for a sample of those pages in one query (`/w/api.php?prop=pageviews`). The server caches both. No Wikipedia account or user data is sent.

## Devvit React Starter

A starter to build web applications on Reddit's developer platform

- [Devvit](https://developers.reddit.com/): A way to build and deploy immersive games on Reddit
- [Vite](https://vite.dev/): For compiling the webView
- [React](https://react.dev/): For UI
- [Hono](https://hono.dev/): For backend logic
- [Tailwind](https://tailwindcss.com/): For styles
- [TypeScript](https://www.typescriptlang.org/): For type safety

## Getting Started

> Make sure you have Node 22 downloaded on your machine before running!

1. Run `npm create devvit@latest --template=react`
2. Go through the installation wizard. You will need to create a Reddit account and connect it to Reddit developers
3. Copy the command on the success page into your terminal

## Commands

- `npm run dev`: Starts a development server where you can develop your application live on Reddit.
- `npm run build`: Builds your client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run type-check`: Type checks, lints, and prettifies your app
