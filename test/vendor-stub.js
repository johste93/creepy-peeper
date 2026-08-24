// Stand-in for the vendors' real loader scripts (fbevents.js, gtag/js, bat.js,
// clarity.js) so the offline fixtures behave like live tags without sending
// anything to Facebook, Google or Microsoft.
(function () {
  var n = window.fbq;
  if (n && !n.callMethod) {
    n.callMethod = function () { console.debug("[stub fbq]", [].slice.call(arguments)); };
    while (n.queue && n.queue.length) n.callMethod.apply(n, n.queue.shift());
  }
  // Only stand in for UET when the UET snippet actually ran. Defining it
  // unconditionally would hand every fixture that loads this stub a fake
  // Microsoft signal — which it did, until google.html grew a second camera.
  if (window.uetq && !window.UET) {
    window.UET = function (o) { this.push = function () {}; return this; };
  }
})();
