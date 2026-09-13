#!/usr/bin/env python3
"""Tiny dependency-free Source RCON client for the local Paper demo server."""
from __future__ import annotations
import argparse
import socket
import struct


def packet(request_id: int, kind: int, text: str) -> bytes:
    body = struct.pack('<ii', request_id, kind) + text.encode() + b'\0\0'
    return struct.pack('<i', len(body)) + body


def receive(sock: socket.socket) -> tuple[int, int, str]:
    raw = sock.recv(4)
    if len(raw) != 4:
        raise RuntimeError('RCON connection closed')
    size = struct.unpack('<i', raw)[0]
    data = b''
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise RuntimeError('RCON short response')
        data += chunk
    request_id, kind = struct.unpack('<ii', data[:8])
    return request_id, kind, data[8:-2].decode(errors='replace')


def run(command: str, host: str, port: int, password: str) -> str:
    with socket.create_connection((host, port), timeout=4) as sock:
        sock.sendall(packet(1, 3, password))
        # Some servers send an empty response before SERVERDATA_AUTH_RESPONSE.
        auth = receive(sock)
        if auth[1] != 2:
            auth = receive(sock)
        if auth[0] == -1:
            raise RuntimeError('RCON authentication failed')
        sock.sendall(packet(2, 2, command))
        response = receive(sock)
        return response[2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('command')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=25575)
    ap.add_argument('--password', default='flycraft')
    args = ap.parse_args()
    print(run(args.command, args.host, args.port, args.password))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
