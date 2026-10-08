import { describe, it, expect } from 'vitest';
import { parseZoomInput, buildZoomNativeChannelLinks } from './zoomParser';

describe('lib/zoomParser', () => {
  it('parses standard Zoom Webinar registration URL with WN_ slug', () => {
    const input = 'https://us02web.zoom.us/webinar/register/WN_k8S9-2JjT82XbQ19Abcdef';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.registrationSlug).toBe('WN_k8S9-2JjT82XbQ19Abcdef');
    expect(result.webinarId).toBe('WN_k8S9-2JjT82XbQ19Abcdef');
    expect(result.isRegistration).toBe(true);
    expect(result.kind).toBe('registration_page');
    expect(result.type).toBe('registration_page');
    expect(result.sourceTrackingBaseUrl).toBe('https://zoom.us/webinar/register/WN_k8S9-2JjT82XbQ19Abcdef');
  });

  it('parses Zoom Webinar join URL with numeric ID and query parameters', () => {
    const input = 'https://us06web.zoom.us/w/84920491823?tk=XyZ987&pwd=secretPassword123';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.zoomId).toBe('84920491823');
    expect(result.webinarId).toBe('84920491823');
    expect(result.kind).toBe('webinar');
    expect(result.type).toBe('webinar');
    expect(result.canonicalJoinUrl).toBe('https://zoom.us/w/84920491823');
  });

  it('parses standard Zoom Meeting join URL', () => {
    const input = 'https://zoom.us/j/9876543210';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.zoomId).toBe('9876543210');
    expect(result.kind).toBe('meeting');
    expect(result.canonicalJoinUrl).toBe('https://zoom.us/j/9876543210');
  });

  it('parses raw user-typed meeting ID with spaces and dashes', () => {
    const input = '849 2049 1823';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.zoomId).toBe('84920491823');
    expect(result.kind).toBe('raw_id');
    expect(result.canonicalJoinUrl).toBe('https://zoom.us/j/84920491823');
  });

  it('handles empty and null inputs safely', () => {
    const resultEmpty = parseZoomInput('');
    expect(resultEmpty.isValid).toBe(false);
    expect(resultEmpty.zoomId).toBeNull();
    expect(resultEmpty.kind).toBe('unknown');

    const resultNull = parseZoomInput(null);
    expect(resultNull.isValid).toBe(false);
    expect(resultNull.zoomId).toBeNull();
  });

  it('builds Zoom native channel tracking links correctly', () => {
    const parsed = parseZoomInput('https://us02web.zoom.us/webinar/register/WN_sample123');
    const links = buildZoomNativeChannelLinks(parsed, ['email_campaign', 'whatsapp', 'linkedin']);

    expect(links.email_campaign).toBe('https://zoom.us/webinar/register/WN_sample123?source=email_campaign');
    expect(links.whatsapp).toBe('https://zoom.us/webinar/register/WN_sample123?source=whatsapp');
    expect(links.linkedin).toBe('https://zoom.us/webinar/register/WN_sample123?source=linkedin');
  });

  it('parses raw WN registration slug without protocol cleanly', () => {
    const input = 'WN_customSlug_99';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.registrationSlug).toBe('WN_customSlug_99');
    expect(result.webinarId).toBe('WN_customSlug_99');
    expect(result.isRegistration).toBe(true);
    expect(result.canonicalJoinUrl).toBe('https://zoom.us/webinar/register/WN_customSlug_99');
    expect(result.sourceTrackingBaseUrl).toBe('https://zoom.us/webinar/register/WN_customSlug_99');
  });

  it('parses Zoom meeting registration page cleanly', () => {
    const input = 'https://us06web.zoom.us/meeting/register/tZIsc-qgrj4vE9example';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.isRegistration).toBe(true);
    expect(result.kind).toBe('meeting');
  });

  it('parses Zoom webinar join link with complex query params', () => {
    const input = 'https://zoom.us/w/84920491823?pwd=secret123&status=success';
    const result = parseZoomInput(input);

    expect(result.isValid).toBe(true);
    expect(result.zoomId).toBe('84920491823');
    expect(result.kind).toBe('webinar');
    expect(result.canonicalJoinUrl).toBe('https://zoom.us/w/84920491823');
  });
});
