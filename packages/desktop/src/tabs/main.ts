import { mount } from 'svelte';
import TabStrip from './TabStrip.svelte';

mount(TabStrip, { target: document.getElementById('tabs') as HTMLElement });
