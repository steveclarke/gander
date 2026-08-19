# Feedback from use

Observations from reviewing real pull requests in Gander are raised as GitHub
issues, where they can be triaged and tracked. This file records what has already
been resolved, so a fixed complaint does not get filed twice.

## Resolved

| Observation | Resolution |
|---|---|
| No noticeable progress while a pull request opened | A spinner and a status line fill the body during the first load |
| Every launch started on two empty menus | The last reviewed pull request reopens |
| Fetching origin had no control, only a 30-second poll | A Fetch origin button, with the poll unchanged |
| Emoji and Unicode glyphs at inconsistent weights | Lucide throughout, one set at one stroke weight |
| A text label on an icon-sized toolbar control | Icon-only with a tooltip |
| The diff tab claimed "vs main" on any base branch | The tabs are icons whose tooltips name the pull request's own base ref |
| Review comments had nowhere to go | Notes capture against a file and line, and reach agents over MCP |
| Everything too small to read comfortably | Zoom on the usual shortcuts, persisted across restarts |
| An agent could not tell which pull request its notes belonged to | The payload names the branch, title, head commit, and stack position |
| An agent had to guess pull request numbers to find notes on a sibling branch | Opening a pull request records every member of its stack |
| Three fixed columns squeezed the diff | Panels resize by dragging, and notes dock beside the diff or beneath it |
