# Phase 5 Testing

This checklist covers the UX refinement work in Phase 5.

## Automated Tests
Run these from the repo root:

- `npm run test:run -- src/components/__tests__/ActivityStream.test.tsx`
- `npm run test:run -- src/components/__tests__/StatusBar.test.tsx`
- `npm run test:run -- src/components/__tests__/ChatTimelineToggle.test.tsx`

## Manual User Flow Tests
1) `npm run tauri dev`
2) Select a workspace and send a message.
3) Confirm the StatusBar shows Planning/Implementing while streaming, then Done.
4) Toggle timeline view and confirm the rail and nodes appear.
5) Confirm each assistant message groups thinking + tool cards + response.
6) Ask the agent to use a tool; confirm ActionCard shows and groups inside the message.
7) Trigger a question modal; confirm StatusBar shows Waiting.

## Accessibility Checks
1) Use keyboard only: Tab through the header controls and the timeline toggle.
2) Ensure focus is visible and the toggle can be activated with Enter/Space.
3) Verify StatusBar text is readable in both light and dark themes.

## Performance Checks
1) Load a long session (20+ messages) and scroll; confirm smooth scroll.
2) Toggle timeline view with a long session; confirm no UI lag.
3) Send a message and watch initial loading skeleton; confirm it disappears once text streams.
