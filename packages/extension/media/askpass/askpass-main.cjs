// IPC client half of the askpass bridge. git (or ssh) runs askpass.sh with a prompt; this
// forwards it — with the per-invocation nonce — to the extension host over the socket in the
// environment, prints the answer to stdout, and exits non-zero on refusal so git aborts.
//
// Refusal covers a confirmation the user declined, not only a cancelled one: OpenSSH takes the
// exit status as the answer to a confirmation and treats zero as consent.
'use strict';
const net = require('node:net');

const handle = process.env.GIT_OCTOPUS_ASKPASS_HANDLE;
const nonce = process.env.GIT_OCTOPUS_ASKPASS_NONCE;
const prompt = process.argv.slice(2).join(' ');
if (!handle || !nonce) process.exit(1);

const MAX_REPLY_BYTES = 65536;
const socket = net.connect(handle);
let buffer = '';
let done = false;

const finish = (code, response) => {
	if (done) return;
	done = true;
	if (response !== undefined) process.stdout.write(response);
	socket.destroy();
	// stdout must flush before the process dies, or git reads an empty answer.
	process.stdout.write('', () => process.exit(code));
};

socket.on('connect', () => {
	socket.write(`${JSON.stringify({ nonce, prompt })}\n`);
});
socket.on('data', (chunk) => {
	buffer += chunk.toString('utf8');
	if (buffer.length > MAX_REPLY_BYTES) return finish(1);
	const newline = buffer.indexOf('\n');
	if (newline === -1) return;
	try {
		const reply = JSON.parse(buffer.slice(0, newline));
		if (reply && typeof reply.ok === 'boolean') {
			// The exit status is the decision — OpenSSH reads a confirmation that way and ignores
			// stdout — while the text, when there is any, is printed either way for the callers
			// that compare it instead.
			const text = typeof reply.response === 'string' ? reply.response : undefined;
			return finish(reply.ok ? 0 : 1, text);
		}
	} catch {
		// Malformed reply — treat as refusal.
	}
	return finish(1);
});
socket.on('error', () => finish(1));
socket.on('close', () => finish(1));
