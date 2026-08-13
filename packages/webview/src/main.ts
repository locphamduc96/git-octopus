import { mount } from 'svelte';
import '@vscode/codicons/dist/codicon.css';
import './styles/tokens.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
	throw new Error('#app mount target not found');
}

mount(App, { target });
