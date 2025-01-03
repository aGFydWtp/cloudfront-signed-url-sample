import { html } from "hono/html";

export interface SiteData {
  title: string;
  description: string;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  children?: any;
}

export const Layout = (props: SiteData) => html`
  <!doctype html>
  <html lang="ja">
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="theme-color" content="#317EFB" />
      <script src="https://unpkg.com/htmx.org@1.9.3"></script>
      <script src="https://unpkg.com/hyperscript.org@0.9.9"></script>
      <script src="https://unpkg.com/htmx.org/dist/ext/json-enc.js"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            fontFamily: {
              sans: 'NotoSansCJKjp, Noto Sans JP, Roboto, arial, sans-serif',
            },
          },
        };
      </script>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&family=Roboto:wght@400;700&display=swap"
        rel="stylesheet"
      />
      <title>${props.title}</title>
      <meta name="description" content="${props.description}" />
    </head>
    <body>
      ${props.children}
    </body>
  </html>
`;
