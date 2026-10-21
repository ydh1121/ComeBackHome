# iPhone status-bar background and original title position

The owner accepted the other PR #95 UI changes but still observed a horizontal
blur band across the tops of headings/settings on the physical iPhone. PR #96
added 24px of portrait clearance. Its layout tests passed, but the owner rejected
the lower title position. That workaround is removed in this same work order.
The Today Find My / call action groups remain centered.

PR #97 restored the original title position and passed all 12 required CI jobs
on its branch and MAIN `e0efdf759585ca0c8bac5516cea5a0ae84435151`. The owner then
reported that the physical iPhone blur was still present on 2026-10-21. This is
a failed device result, not an accepted blur fix.

## Original position, separate status background

The shell once again uses only the top safe inset, with its original main
padding. No extra title offset or compensating bottom-padding subtraction remains.
In iOS home-screen mode (navigator.standalone), an opaque, viewport-fixed
background covers the top safe inset, with a 12px minimum. It is outside the route
transition, follows the light/dark paper color, ignores pointer events, and has no
filter, gradient, translucency or layout footprint. When the native status area
is outside the web viewport, the minimum occupies the existing blank top gutter;
it does not move or cover the original heading. Ordinary browser tabs have no
such element. The compact roster line-height
fix and safe-inset sizing remain, including 54px row/44px control minimums.

This targets WebKit's edge-color treatment, rather than shifting text away from
it. WebKit's [296485 commit](https://commits.webkit.org/296485@main) explains that
a qualifying viewport-constrained element near an edge causes solid inset color
to be used instead of the native scroll-edge blur. The
[fixedContainerEdges implementation](https://github.com/WebKit/WebKit/blob/d3afea7d89fd2b062ef39b644c3f026dc4904070/Source/WebCore/page/LocalFrameView.cpp)
samples near the edge, checks fixed/sticky containers spanning most of its width,
and distinguishes opaque backgrounds from backdrop filters. The full-width status
background is visible to that sampling even with pointer events disabled.

PR #97 used only the safe inset for the background height, so a zero inset made
it disappear. [WebKit bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
records standalone iOS configurations with a zero top inset and a native status
region outside a shorter web viewport. The source above ignores edge-color
boxes at most 10px high, so the 12px minimum also avoids that threshold. No
device-model or OS-version height is hardcoded. This closes a concrete missing
case, but the owner's actual inset has not been measured; it is not proof that
this is the only cause of the physical blur.

The screenshot pattern is consistent with this native treatment, but it is not
an Apple-confirmed diagnosis of this device. Desktop WebKit does not expose the
native iOS compositor. Software geometry success must not be called physical
iPhone blur acceptance.

## Horizontal edge swipe

The owner's capture shows the native interactive back/forward transition: the
rounded snapshot of the entire web view, including the floating bar, moves.
CSS fixed positioning anchors a web element inside that view; it cannot pin the
element outside a native history snapshot. Apple's
[back/forward navigation gesture setting](https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures)
belongs to the native WKWebView host, not PWA JavaScript.

Normal in-app tab navigation keeps the same navigation element fixed and moves
the selection pill. Preserve native back navigation, browser history, accessibility
and scrolling; do not intercept all touch events or silently replace tab history.
No custom content-swipe feature is added to imitate the system gesture.

## Evidence and remaining device check

Phase B checks Chromium and WebKit with top insets 0/47/59, bottom inset 34,
five routes and both themes (30 cases per engine). The zero-inset case uses a
shorter 390x797 viewport; the inset cases use 390x844. Painted heading/icon bounds must equal the accepted
ordinary-browser position plus the safe inset, with no extra 24px. It also checks
opaque coverage without heading overlap, zero layout contribution, compact-page
fit, centered Today actions, bar/edge persistence across SPA navigation/history,
scroll anchoring, and desktop/landscape zero-inset behavior. The 12px fallback
must remain visible without covering painted text or changing layout. Private captures never
enter the repository or CI; all browser fixtures are synthetic and D1 is local.

After deployment, the owner needs only to reopen the existing PWA and check the
original title position and sharp top of the letters. No reinstall, accessibility
setting change, alarm action or data reset is required. Physical blur and native
gesture acceptance remain separate from automated browser evidence.
