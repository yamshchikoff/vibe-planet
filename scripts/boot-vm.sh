#!/bin/bash
# Boot the QEMU full-emulation VM
# Prerequisites: /home/agent/qemu-vm/ must be set up (see docs/qemu-vm.md)
set -e
QEMU_DIR="${QEMU_DIR:-/home/agent/qemu-vm}"
if [ ! -f "$QEMU_DIR/overlay.raw" ]; then
  echo "Error: QEMU setup not found in $QEMU_DIR"
  echo "See docs/qemu-vm.md for first-time setup instructions."
  exit 1
fi
cd "$QEMU_DIR"
exec qemu-system-x86_64 \
  -machine type=pc \
  -cpu qemu64 \
  -m 1G \
  -smp 1 \
  -drive file=overlay.raw,format=raw,if=virtio \
  -cdrom seed.iso \
  -nic user,model=virtio-net-pci,hostfwd=tcp::8080-:8080,hostfwd=tcp::2222-:22 \
  -device virtio-rng-pci \
  -nographic \
  "$@"
