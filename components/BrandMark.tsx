// The Webinar Studio mark. One copy, used by the sidebar and the sign-in page. The colours are the brand's own,
// which is why this file (like the LeadSquared wordmark in the sidebar) is the exception to the no-raw-hex rule.
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="87.2732" height="87.2732" fill="#0C9AFC" />
      <path d="M0 43.3984H43.875V87.2735H0V43.3984Z" fill="#172738" />
      <path d="M43.875 43.3984H0L43.875 87.2735V43.3984Z" fill="#F5F5F5" />
    </svg>
  );
}
