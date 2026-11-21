// One PNG per page at /og/<path>.png. See src/lib/og.ts.
import type { APIContext } from 'astro';
import { cards, renderCard, type Card } from '../../lib/og';

export async function getStaticPaths() {
  return (await cards()).map((card) => ({ params: { path: card.path }, props: { card } }));
}

export async function GET({ props }: APIContext<{ card: Card }>) {
  return new Response(new Uint8Array(await renderCard(props.card)), { headers: { 'Content-Type': 'image/png' } });
}
