import { expect, it } from "vitest";
import { SOLAR_BODIES, solarPosition } from "./solarOrbits";
it("keeps eight planets ordered and Earth near its starting point after one orbital year",()=>{
  expect(SOLAR_BODIES.map(body=>body.id)).toEqual(["mercury","venus","earth","mars","jupiter","saturn","uranus","neptune"]);
  const earth=SOLAR_BODIES[2],epoch=Date.UTC(2026,10,3),a=solarPosition(earth,epoch),b=solarPosition(earth,epoch+365.2569*86400000);
  expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(.001);
});
it("gives Mercury an elliptical path with perihelion closer than aphelion",()=>{
  const mercury=SOLAR_BODIES[0],near=solarPosition(mercury,Date.UTC(2000,0,1,12),0),far=solarPosition(mercury,Date.UTC(2000,0,1,12),Math.PI);
  expect(Math.hypot(near.x,near.y,near.z)).toBeCloseTo(.3075,3);expect(Math.hypot(far.x,far.y,far.z)).toBeCloseTo(.4667,3);
});
