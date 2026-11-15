# Identity & devices

## You are a key

Your identity is a keypair made on first run, kept per profile at
`~/.config/collagen/identity-<profile>.json`, plus a display name. There is no login:
whoever runs collagen with that file is you. Tickets, messages and a room's roles name
you by that key.

## One person, several machines <Badge type="tip" text="live" />

You can be the same person on a second machine. Each machine keeps a key of its own;
signed acts say which machines are yours, and every room you are in reads them. To the
others you are one person: one entry in the roster, one member, whichever machine you
are at.

**Add a machine.** On the machine you already use, open **You** (`i`) and press
`ctrl+d`: a device code is on your clipboard. On the other machine:

```sh
collagen connect-device <code>
```

It comes up as you, in your rooms, under your name. The code lets one machine in, for
ten minutes; the two need no room in common. If collagen is already running on the other
machine, the same command hands the code to it and it becomes you at once.

Your agent can do both halves: `device-code` makes the code, `take-identity` with
`code` uses it. Two machines already in one room can also do it by name —
`share-identity` on one, `take-identity` on the other, each naming the other, within
five minutes. Either half alone does nothing.

**What your machines share.** Your rooms (one entered or left on one machine is
entered or left on the others, a machine that was off included), your name, and the
list of your devices. They share it through a log only your devices can read.

**What they do not share.** Your agent's conversations stay on the machine they are in:
a message for you reaches every machine, and wakes only a conversation that listens for
it. [Steering](./conversations#steering-how-much-your-agent-does-on-its-own) is per
machine too, so a new machine does nothing in your name until you turn it up there.

## The parent device

One of your devices is the parent: the one you started on, until you hand that on. Only
the parent makes device codes, puts a device out, and hands the parent's part to another
device (`set-device`, or ask your agent). `devices` lists them: which is this one, which
the parent. Any device can rename any device.

**Putting a device out** is for a machine you no longer have. Nothing it does counts as
you from then; every room you are in moves to a key it is not given, and so does the
log your devices share. It keeps what it had already read, and reads nothing after.
It is not undone.

**Handing the parent's part on** makes another device the parent and this one ordinary;
the new parent can then put the old one out. Do it before you retire the machine you
started on.

## What is not there yet

- **A lost parent.** With the parent gone and its part not handed on, nobody can add or
  put out devices for you; the ones you have keep working. There is no recovery phrase.
- **Earlier work.** Tickets a machine filed as someone else before it became yours stay
  under that earlier key. Add a machine before you work on it.
- **Logging out.** A machine cannot yet forget you on its own; put it out from the parent.
