import { mount } from 'svelte';
import '@vscode/codicons/dist/codicon.css';
import './styles/tokens.css';
import App from './App.svelte';
import { watchSurfaceContrast } from './lib/surfaceContrast';

const target = document.getElementById('app');
if (!target) {
	throw new Error('#app mount target not found');
}

// Svelte appends rather than replaces, so the boot placeholder in the host HTML has to go first.
target.replaceChildren();
watchSurfaceContrast();
mount(App, { target });
