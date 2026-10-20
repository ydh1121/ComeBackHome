# iPhone home-screen top clearance

The owner's October 20 physical-iPhone captures still show a horizontal blur
band across the tops of People, Import and Schedule titles and the Today
settings icon after PR #95. The owner accepted the other changes. Keep that
acceptance; the previous desktop-WebKit result did not establish native iOS
status-bar acceptance. Private screenshots are not committed or sent to CI.

There is no application blur overlay in that top region. The screenshots are
consistent with a native status-bar treatment extending below the safe inset.
This is an inference, not a confirmed Apple diagnosis. A similar first-hand
report exists on [Apple Developer Forums](https://developer.apple.com/forums/thread/848733).
[WebKit's safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
also distinguishes safe insets from the additional margins content needs.

In portrait iOS home-screen mode only, reserve 24 CSS pixels above the content.
Identify that mode using Apple's navigator.standalone property; ordinary
browser tabs, desktop and landscape retain the accepted layout. Reallocate
24 pixels from the existing generous bottom content spacer, preserving the
page-height budget and keeping the floating navigation and its safe inset.
The application does not attempt to override native compositing or ask the
owner to change iOS accessibility settings.

The Phase B Chromium/WebKit tests emulate standalone and top insets of 47/59
pixels plus a 34-pixel bottom inset. They check painted title/icon bounds,
five affected routes in both themes, viewport fit and navigation clearance,
and unchanged ordinary-browser/desktop/landscape geometry. These are layout
checks, not a reproduction of the native iPhone blur. Only the owner's next
physical-iPhone check can close that remaining acceptance item.
