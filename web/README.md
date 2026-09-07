# Embedded Frontend

Run `npm --prefix frontend ci` and `npm --prefix frontend run build` before building
the Go binary. Vite writes the production application to `web/dist/`; `main.go`
embeds this directory through its `web` filesystem. Generated assets are ignored
by Git and rebuilt by the release workflow. The server reports a startup error
when the frontend has not been built.
