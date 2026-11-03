import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

/** A sparse screen-space star field behind the globe; the basemap occludes it. */
export function addStarfield(map: MapLibreMap) {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const count = 260;
  const layer: CustomLayerInterface = {
    id: "night-stars", type: "custom", renderingMode: "2d",
    onAdd(_map, context) {
      const gl = context as WebGL2RenderingContext;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Star shader unavailable"); }
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
        in vec4 star; uniform float fade; out float light;
        void main() { gl_Position=vec4(star.xy,0.,1.); gl_PointSize=star.z; light=star.w*fade; }`);
      const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision mediump float; in float light; out vec4 color;
        void main() { float a=(1.-smoothstep(.08,.5,length(gl_PointCoord-.5)))*light; color=vec4(.78,.86,1.,a); }`);
      program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Star program unavailable");
      const values = new Float32Array(count * 4);
      const random = (n: number) => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
      for (let index = 0; index < count; index++) values.set([random(index * 4) * 2 - 1, random(index * 4 + 1) * 2 - 1, (0.8 + random(index * 4 + 2) * 2.1) * Math.min(devicePixelRatio, 2), 0.25 + random(index * 4 + 3) * 0.6], index * 4);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, "star"); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    },
    render(context) {
      if (!program || !vao) return;
      const fade = Math.max(0, Math.min(1, (3.5 - map.getZoom()) / 1.2));
      if (!fade) return;
      const gl = context as WebGL2RenderingContext;
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.uniform1f(gl.getUniformLocation(program, "fade"), fade);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST); gl.drawArrays(gl.POINTS, 0, count); gl.bindVertexArray(null);
    },
    onRemove(_map, context) { const gl = context as WebGL2RenderingContext; gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program); },
  };
  map.addLayer(layer, map.getStyle().layers[0]?.id);
}
