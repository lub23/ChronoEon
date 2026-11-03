/** JPL approximate elements, J2000; angles in degrees, rates per Julian century.
 * Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html (Table 1, 1800–2050).
 * Distances and rendered radii are deliberately compressed for a readable diagram.
 */
export const SOLAR_BODIES = [
  {id:"mercury",zh:"水星",en:"Mercury",color:"#a6a39a",size:3.5,orbit:.15,elements:[.38709927,.20563593,7.00497902,252.2503235,77.45779628,48.33076593],rates:[.00000037,.00001906,-.00594749,149472.67411175,.16047689,-.12534081]},
  {id:"venus",zh:"金星",en:"Venus",color:"#d8be89",size:5,orbit:.25,elements:[.72333566,.00677672,3.39467605,181.9790995,131.60246718,76.67984255],rates:[.00000390,-.00004107,-.00078890,58517.81538729,.00268329,-.27769418]},
  {id:"earth",zh:"地球",en:"Earth",color:"#4c9ec5",size:5.6,orbit:.35,elements:[1.00000261,.01671123,-.00001531,100.46457166,102.93768193,0],rates:[.00000562,-.00004392,-.01294668,35999.37244981,.32327364,0]},
  {id:"mars",zh:"火星",en:"Mars",color:"#c77957",size:4,orbit:.46,elements:[1.52371034,.0933941,1.84969142,-4.55343205,-23.94362959,49.55953891],rates:[.00001847,.00007882,-.00813131,19140.30268499,.44441088,-.29257343]},
  {id:"jupiter",zh:"木星",en:"Jupiter",color:"#c5a98c",size:13,orbit:.60,elements:[5.202887,.04838624,1.30439695,34.39644051,14.72847983,100.47390909],rates:[-.00011607,-.00013253,-.00183714,3034.74612775,.21252668,.20469106]},
  {id:"saturn",zh:"土星",en:"Saturn",color:"#d4c49b",size:10.5,orbit:.73,elements:[9.53667594,.05386179,2.48599187,49.95424423,92.59887831,113.66242448],rates:[-.00125060,-.00050991,.00193609,1222.49362201,-.41897216,-.28867794]},
  {id:"uranus",zh:"天王星",en:"Uranus",color:"#96d0d2",size:8,orbit:.86,elements:[19.18916464,.04725744,.77263783,313.23810451,170.9542763,74.01692503],rates:[-.00196176,-.00004397,-.00242939,428.48202785,.40805281,.04240589]},
  {id:"neptune",zh:"海王星",en:"Neptune",color:"#517fd3",size:7.7,orbit:1,elements:[30.06992276,.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],rates:[.00026291,.00005105,.00035372,218.45945325,-.32241464,-.00508664]},
] as const;
export type SolarBody = typeof SOLAR_BODIES[number];
const rad=(degrees:number)=>degrees*Math.PI/180;

/** Solve the eccentric anomaly, then rotate into the ecliptic plane. */
export function solarPosition(body: SolarBody, date: number, eccentricAnomaly?: number): { x:number;y:number;z:number;a:number } {
  const centuries=(date-Date.UTC(2000,0,1,12))/(86400000*36525);
  const [a,e,i,l,peri,node]=body.elements.map((element,index)=>element+body.rates[index]*centuries);
  const mean=rad(((l-peri)%360+540)%360-180);
  let E=eccentricAnomaly ?? mean;
  if(eccentricAnomaly===undefined) for(let step=0;step<6;step++) E-=(E-e*Math.sin(E)-mean)/(1-e*Math.cos(E));
  const x=a*(Math.cos(E)-e),y=a*Math.sqrt(1-e*e)*Math.sin(E);
  const w=rad(peri-node),n=rad(node),inclination=rad(i);
  return { x:(Math.cos(w)*Math.cos(n)-Math.sin(w)*Math.sin(n)*Math.cos(inclination))*x+(-Math.sin(w)*Math.cos(n)-Math.cos(w)*Math.sin(n)*Math.cos(inclination))*y,
    y:(Math.cos(w)*Math.sin(n)+Math.sin(w)*Math.cos(n)*Math.cos(inclination))*x+(-Math.sin(w)*Math.sin(n)+Math.cos(w)*Math.cos(n)*Math.cos(inclination))*y,
    z:Math.sin(w)*Math.sin(inclination)*x+Math.cos(w)*Math.sin(inclination)*y,a };
}
