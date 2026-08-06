// CloudFront Function "kiosk-index-rewrite" (viewer-request) on the
// distribution serving kiosk.aogcoin.club (E28CSTH4NONUBK). Source of truth
// lives here in the repo; deploy manually with:
//
//   ETAG=$(aws cloudfront describe-function --name kiosk-index-rewrite --query ETag --output text)
//   aws cloudfront update-function --name kiosk-index-rewrite --if-match "$ETAG" \
//     --function-config Comment="Rewrite folder URLs to index.html for kiosk.aogcoin.club",Runtime="cloudfront-js-1.0" \
//     --function-code fileb://cloudfront/kiosk-index-rewrite.js
//   ETAG=$(aws cloudfront describe-function --name kiosk-index-rewrite --query ETag --output text)
//   aws cloudfront publish-function --name kiosk-index-rewrite --if-match "$ETAG"
//
// Does two things:
// 1. Folder URLs -> index.html (S3 REST origins can't serve directory
//    indexes), e.g. /autodist/portrait/ -> /autodist/portrait/index.html.
// 2. Signage platforms (MDD) append "&dist=_MDD_VENUEID" to a base URL that
//    has no "?", so the params land in the PATH: /autodist/portrait&dist=123.
//    That gets a 302 to the clean folder URL with a real query string
//    (/autodist/portrait/?dist=123) — a redirect, not a rewrite, because the
//    browser must end up on the folder path for the page's relative URLs
//    (../config.js, kiosk.html) to resolve.

function handler(event) {
  var req = event.request;

  var amp = req.uri.indexOf('&');
  if (amp !== -1) {
    var path = req.uri.slice(0, amp);
    var extra = req.uri.slice(amp + 1);
    if (!path.endsWith('/')) path += '/';
    var qs = [];
    if (extra) qs.push(extra);
    // Preserve any real query string the URL also carried.
    for (var k in req.querystring) {
      qs.push(k + (req.querystring[k].value ? '=' + req.querystring[k].value : ''));
    }
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: path + (qs.length ? '?' + qs.join('&') : '') } }
    };
  }

  if (req.uri.endsWith('/')) {
    req.uri += 'index.html';
  } else if (!req.uri.includes('.')) {
    req.uri += '/index.html';
  }
  return req;
}
