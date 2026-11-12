const blocks = [
  // North, beyond the main arch and the far workshop.
  [-47, -84, 19, 12, 13.4, 0xa59986], [-27, -91, 15, 15, 17.3, 0xb1a59a],
  [-12, -79, 9, 11, 10.1, 0xb2a48f], [-1, -89, 11, 16, 13.8, 0xb7a18d],
  [11, -88, 12, 14, 11.7, 0x9ea4a1], [26, -93, 15, 13, 17.1, 0xa5a69c],
  [42, -80, 15, 11, 11.2, 0xb9a48d], [59, -92, 18, 13, 15.8, 0xafa38d],
  // Rooflines behind the southern approach.
  [-47, 83, 17, 13, 12.3, 0xb3a38f], [-28, 88, 14, 16, 14.5, 0xaa9a87],
  [-13, 81, 10, 12, 9.1, 0xaa9b83], [7, 91, 17, 17, 14.1, 0xb1a395],
  [26, 87, 15, 12, 12.3, 0xb5aa98], [47, 83, 19, 13, 14.8, 0xa5a49a],
  // Side-street openings face a lower, predominantly residential district.
  [-83, -42, 12, 19, 12.6, 0xacaa9c], [-87, -19, 15, 16, 16.2, 0xb7a993],
  [-80, 0, 11, 16, 10.9, 0xab9d89], [-90, 21, 15, 18, 14.1, 0xb6a895],
  [-81, 43, 12, 18, 12.8, 0xa4a697], [82, -38, 12, 16, 12.5, 0xb2a38f],
  [90, -17, 15, 19, 15.8, 0xa9a69d], [81, 7, 14, 21, 11.5, 0xa8aa9f],
  [87, 30, 15, 17, 14.2, 0xb4a897], [83, 49, 14, 13, 11.6, 0xae9e89],
];

export function addMarketSkyline(local, shade) {
  for (const [i, [x, z, w, d, height, tint]] of blocks.entries()) {
    const sideStreet = Math.abs(x) > 75;
    const angle = sideStreet ? -Math.sign(x) * Math.PI / 2 : z > 0 ? Math.PI : 0;
    const front = local(x, z, angle);
    const width = sideStreet ? d : w;
    const depth = sideStreet ? w : d;
    const wall = (color, u, y, v, sx, sy, sz) => front.box('skyline', color, u, y, v, sx, sy, sz);
    wall(tint, 0, height / 2, 0, width, height, depth);
    wall(shade(tint, 1.09), 0, height + .11, 0, width + .31, .31, depth + .31);
    wall(shade(tint, .94), width * .22, height + .82, -depth * .17, width * .31, 1.51, depth * .42);
    if (i % 3 !== 1) {
      wall(shade(tint, .69), -width * .27, height + .63, depth * .18, 1.29, 1.08, 1.36);
    }
    const bays = Math.floor(width / 3);
    const span = width / bays;
    for (let level = 0; level < 3; level++) {
      const y = height - 1.78 - level * 2.9;
      wall(shade(tint, .89), 0, y - 1.08, depth / 2 + .013, width + .04, .115, .14);
      for (let bay = 0; bay < bays; bay++) {
        if ((bay * 2 + i + level) % 9 === 0) continue;
        const u = -width / 2 + span * (bay + .5);
        wall(shade(tint, .44), u, y, depth / 2 + .012, .76, 1.19, .034);
        wall(shade(tint, 1.02), u, y - .64, depth / 2 + .058, 1.02, .115, .26);
      }
    }
  }
}
