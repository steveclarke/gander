# Settings dropdown verification

- `packages/app/e2e/settings-controls.spec.ts` writes these screenshots on macOS in the Gander Light theme. Servers and repositories are synthetic QA data.
- Every settings dropdown is drawn as the macOS pop-up button: rounded box, up-and-down chevron, one accent focus ring.
- The spec fails while any settings dropdown keeps Chromium's own control or stacks a second focus outline.
- The open list is a native macOS menu and does not appear in a window screenshot.

![Connection settings with a focused dropdown](connection.png)

![Workbench settings with a focused dropdown](workbench.png)
