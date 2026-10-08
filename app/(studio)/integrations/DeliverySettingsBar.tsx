export function DeliverySettingsBar({ deliveryItems }: { deliveryItems: { label: string; value: string }[] }) {
  return <section className="lsq-int-delivery"><div className="lsq-int-delivery__body">
    <h2>Delivery settings</h2><p>Messages are sent to the selected recipients through the configured providers.</p>
    <dl className="lsq-int-delivery__list">{deliveryItems.map(d => <div key={d.label} className="lsq-int-delivery__item"><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
  </div></section>;
}
