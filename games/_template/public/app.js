/* global io */

const socket = io();
const dot = document.querySelector('#dot');
const statusEl = document.querySelector('#status');
const resultEl = document.querySelector('#result');

function setStatus(text, online) {
  statusEl.textContent = text;
  dot.classList.toggle('is-online', online);
}

socket.on('connect', () => setStatus('подключено', true));
socket.on('disconnect', () => setStatus('нет связи', false));
socket.on('hello', () => setStatus('подключено', true));

document.querySelector('#ping').addEventListener('click', () => {
  socket.emit('ping:send', {}, (response) => {
    resultEl.textContent = `Ответ сервера: ${new Date(response.at).toLocaleTimeString()}`;
  });
});
