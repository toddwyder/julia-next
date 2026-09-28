import { version } from '../package.json';

export default function Page() {
  return (
    <main>
      <div>Julia {version}</div>
      <p>what are we cooking today?</p>
    </main>
  );
}
