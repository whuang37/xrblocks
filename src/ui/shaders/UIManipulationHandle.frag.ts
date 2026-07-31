import {CommonFunctionsShader} from './CommonFunctions.glsl';

/** Fragment shader for the hover-lit manipulation edge around a UI card. */
export const UIManipulationHandleFragmentShader =
  CommonFunctionsShader +
  `
#include <common>
#include <dithering_pars_fragment>

varying vec2 vUv;

uniform vec2 u_resolution;
uniform float u_corner_radius;
uniform float u_edge_width;
uniform vec4 u_edge_color;
uniform vec4 u_spotlight_color;
uniform float u_spotlight_radius;
uniform float u_spotlight_blur;
uniform vec2 u_cursor_uv;
uniform float u_show_glow;
uniform vec2 u_cursor_uv_2;
uniform float u_show_glow_2;
uniform float u_debug;

float cursorGlow(vec2 position, vec2 cursorUv, float enabled, vec2 size) {
    if (enabled < 0.5) return 0.0;
    float sigma = max(1.0, u_spotlight_radius + u_spotlight_blur);
    vec2 cursorPosition = cursorUv * size;
    float distanceSquared = pow(distance(position, cursorPosition), 2.0);
    return exp(-0.5 * distanceSquared / (sigma * sigma));
}

void main() {
    vec2 size = u_resolution;
    vec2 position = vUv * size;
    vec2 centered = position - size * 0.5;
    vec2 halfSize = size * 0.5;
    float radius = min(u_corner_radius, min(halfSize.x, halfSize.y));
    float distanceToEdge = sdRoundedBox(centered, halfSize, radius);
    float aa = fwidth(distanceToEdge);
    float panelMask = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, distanceToEdge);

    if (panelMask < 0.001) discard;

    float glow = max(
        cursorGlow(position, u_cursor_uv, u_show_glow, size),
        cursorGlow(position, u_cursor_uv_2, u_show_glow_2, size)
    );
    float edgeMask = smoothstep(-u_edge_width - aa, -u_edge_width, distanceToEdge);
    vec4 color = u_edge_color;
    color.a *= edgeMask * glow * panelMask;

    vec4 spotlight = u_spotlight_color;
    spotlight.a *= glow * edgeMask * 0.35 * panelMask;
    color.rgb = mix(color.rgb, spotlight.rgb, spotlight.a);
    color.a = max(color.a, spotlight.a);

    if (u_debug > 0.5) {
        color = mix(color, vec4(1.0, 0.0, 0.0, 0.2), 0.2);
        color.a = max(color.a, 0.15 * panelMask);
    }

    if (color.a < 0.001) discard;
    gl_FragColor = color;

    #include <dithering_fragment>
}
`;
