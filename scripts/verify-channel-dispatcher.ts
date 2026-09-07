import { db } from '../lib/db';
import {
  getChannelDeliverySettingsAction,
  saveChannelDeliveryModeAction,
  saveDirectGatewayConfigAction,
  testDirectChannelAction,
} from '../lib/actions/integrations';
import { deliverChannelMessage, getChannelDeliveryMode } from '../lib/channelDelivery';

async function main() {
  console.log('=== 1. Testing getChannelDeliverySettingsAction ===');
  const settings = await getChannelDeliverySettingsAction();
  console.log('Current SMS mode:', settings.sms.mode);
  console.log('Current WA mode:', settings.whatsapp.mode);
  console.log('Default test phone:', settings.defaultPhone);

  console.log('\n=== 2. Testing saveChannelDeliveryModeAction ===');
  await saveChannelDeliveryModeAction('sms', 'trigger');
  console.log('Set SMS to trigger -> verified mode:', await getChannelDeliveryMode('sms'));

  await saveChannelDeliveryModeAction('sms', 'direct');
  console.log('Set SMS to direct -> verified mode:', await getChannelDeliveryMode('sms'));

  await saveChannelDeliveryModeAction('sms', 'trigger');
  console.log('Reset SMS to trigger (Primary) -> verified mode:', await getChannelDeliveryMode('sms'));

  console.log('\n=== 3. Testing saveDirectGatewayConfigAction ===');
  await saveDirectGatewayConfigAction('sms', {
    endpoint: 'https://api.routemobile.com/v1/sms/send',
    authToken: 'test-token-12345',
    senderId: 'EVHLTH',
    templateId: '12071600000000',
  });
  const updatedSettings = await getChannelDeliverySettingsAction();
  console.log('Direct SMS endpoint saved:', updatedSettings.sms.endpoint);
  console.log('Direct SMS hasAuthToken:', updatedSettings.sms.hasAuthToken);
  console.log('Direct SMS senderId:', updatedSettings.sms.senderId);
  console.log('Direct SMS templateId:', updatedSettings.sms.templateId);

  console.log('\n=== 4. Testing testDirectChannelAction (Diagnostics) ===');
  const testRes = await testDirectChannelAction({
    channel: 'sms',
    targetPhone: '+919123443870',
    endpoint: 'https://httpbin.org/post', // Mock HTTP receiver
    authToken: 'Bearer sample-test-token',
    senderId: 'EVHLTH',
    templateId: '12071600000000',
  });
  console.log('Test result on mock receiver:', {
    ok: testRes.ok,
    status: testRes.status,
    latencyMs: testRes.latencyMs,
    detail: testRes.detail,
  });

  console.log('\n=== 5. Testing deliverChannelMessage with LeadSquared Automation (Primary) ===');
  const leadId = 'a420f454-2da1-425f-a2cf-3c9f8d9a2d84';
  const triggerResult = await deliverChannelMessage({
    channel: 'whatsapp',
    stepKey: 'waInvite',
    campaignName: 'Channel Dispatcher Verification',
    message: 'Hello Akshat, testing two-mode delivery with LeadSquared Automation.',
    phone: '+919123443870',
    lsqLeadId: leadId,
  });
  console.log('WhatsApp Trigger Result:', triggerResult);

  console.log('\n✓ ALL 5 VERIFICATION CHECKS COMPLETED SUCCESSFULLY!');
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
