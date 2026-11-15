import Script from 'next/script';

/**
 * Microsoft Clarity (heatmaps + session recordings). Loaded only when
 * NEXT_PUBLIC_CLARITY_PROJECT_ID is set, after the page is interactive.
 *
 * Privacy: resume text, job descriptions, the review diff, the export preview and API-key
 * fields carry data-clarity-mask="True", so they are never captured in recordings.
 */
export function Analytics() {
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim();
  if (!clarityId || !/^[a-z0-9]{6,20}$/i.test(clarityId)) return null;
  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarityId}");`}
    </Script>
  );
}
