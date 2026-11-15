import { describe, expect, it } from "vitest";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { devicesOf, foldDevices, personOf, signConsent, signDevice, type DeviceAct, type DeviceEntry } from "./devices";

const device = () => {
  const pair = crypto.keyPair();
  return { key: b4a.toString(pair.publicKey, "hex"), pair };
};
type Device = ReturnType<typeof device>;

let clock = 0;
const act = (person: Device, by: Device, after: DeviceEntry | null, what: DeviceAct): DeviceEntry =>
  signDevice({ id: `e${++clock}`, person: person.key, by: by.key, at: clock, after: after?.id ?? null, act: what }, by.pair);
const link = (person: Device, by: Device, after: DeviceEntry | null, taken: Device, name = "") =>
  act(person, by, after, { kind: "link", device: taken.key, name, consent: signConsent(person.key, taken.key, taken.pair) });

const permutations = <A>(items: ReadonlyArray<A>): Array<Array<A>> =>
  items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

describe("a person's devices", () => {
  it("someone no act is about is their own one device", () => {
    const alone = device();
    expect(personOf(foldDevices([]), alone.key)).toBe(alone.key);
    expect(devicesOf(foldDevices([]), alone.key).parent).toBe(alone.key);
  });

  it("a device taken in acts as the person, under the name it was given", () => {
    const desk = device();
    const laptop = device();
    const devices = foldDevices([link(desk, desk, null, laptop, "laptop")]);
    expect(personOf(devices, laptop.key)).toBe(desk.key);
    expect([...devicesOf(devices, desk.key).devices]).toEqual([[desk.key, ""], [laptop.key, "laptop"]]);
  });

  it("nobody is made someone's device unasked, or by anyone but the parent", () => {
    const desk = device();
    const laptop = device();
    const stranger = device();
    const unasked = act(desk, desk, null, { kind: "link", device: stranger.key, name: "", consent: signConsent(desk.key, stranger.key, desk.pair) });
    expect(personOf(foldDevices([unasked]), stranger.key)).toBe(stranger.key);
    // the laptop is the person's, not the parent: it takes nobody in
    const first = link(desk, desk, null, laptop);
    const byChild = link(desk, laptop, first, stranger);
    expect(personOf(foldDevices([first, byChild]), stranger.key)).toBe(stranger.key);
    // and a forged act counts for nothing
    expect(personOf(foldDevices([{ ...first, by: stranger.key }]), laptop.key)).toBe(laptop.key);
  });

  it("a device put out is nobody, and stays out", () => {
    const desk = device();
    const laptop = device();
    const first = link(desk, desk, null, laptop);
    const out = act(desk, desk, first, { kind: "unlink", device: laptop.key });
    const again = link(desk, desk, out, laptop);
    const devices = foldDevices([first, out, again]);
    expect(personOf(devices, laptop.key)).toBe(null);
    expect(devicesOf(devices, desk.key).devices.has(laptop.key)).toBe(false);
  });

  it("the parent's part is handed on: the new parent acts, the old one no longer does — and can be put out", () => {
    const desk = device();
    const laptop = device();
    const phone = device();
    const first = link(desk, desk, null, laptop);
    const handed = act(desk, desk, first, { kind: "parent", device: laptop.key });
    const byOld = link(desk, desk, handed, phone);
    const deskOut = act(desk, laptop, handed, { kind: "unlink", device: desk.key });
    const devices = foldDevices([first, handed, byOld, deskOut]);
    expect(devicesOf(devices, desk.key).parent).toBe(laptop.key);
    expect(personOf(devices, phone.key)).toBe(phone.key);
    expect(personOf(devices, desk.key)).toBe(null);
    // the person is still known by the key they started on
    expect(personOf(devices, laptop.key)).toBe(desk.key);
  });

  it("the acts count the same in whatever order they arrive", () => {
    const desk = device();
    const laptop = device();
    const phone = device();
    const first = link(desk, desk, null, laptop, "laptop");
    const second = link(desk, desk, first, phone, "phone");
    const handed = act(desk, desk, second, { kind: "parent", device: laptop.key });
    const out = act(desk, laptop, handed, { kind: "unlink", device: phone.key });
    const renamed = act(desk, laptop, null, { kind: "name", device: desk.key, name: "desk" });
    const shape = (entries: ReadonlyArray<DeviceEntry>) => {
      const devices = foldDevices(entries);
      const mine = devicesOf(devices, desk.key);
      return { parent: mine.parent, devices: [...mine.devices].sort(), gone: [...devices.gone].sort() };
    };
    const expected = { parent: laptop.key, devices: [[desk.key, "desk"], [laptop.key, "laptop"]].sort(), gone: [[phone.key, desk.key]] };
    for (const order of permutations([first, second, handed, out, renamed])) expect(shape(order)).toEqual(expected);
    // and a copy seen twice changes nothing
    expect(shape([first, first, second, handed, out, out, renamed])).toEqual(expected);
  });

  it("a parent that hands its part on and then speaks again is not heard: the first act in the log stands", () => {
    const desk = device();
    const laptop = device();
    const first = link(desk, desk, null, laptop);
    const handed = act(desk, desk, first, { kind: "parent", device: laptop.key });
    const takenBack = act(desk, desk, first, { kind: "unlink", device: laptop.key });
    expect(devicesOf(foldDevices([first, handed, takenBack]), desk.key).parent).toBe(laptop.key);
    // even when what they both follow arrives after them
    expect(devicesOf(foldDevices([handed, takenBack, first]), desk.key).parent).toBe(laptop.key);
  });

  it("a device is one person's: the first to take it in keeps it", () => {
    const desk = device();
    const other = device();
    const laptop = device();
    const devices = foldDevices([link(desk, desk, null, laptop), link(other, other, null, laptop)]);
    expect(personOf(devices, laptop.key)).toBe(desk.key);
    expect(devicesOf(devices, other.key).devices.has(laptop.key)).toBe(false);
  });
});
