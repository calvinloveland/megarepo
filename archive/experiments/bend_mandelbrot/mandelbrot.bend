
def mandelbrot(depth):
  bend d = 0, i = 0:
    when d < depth:
      iteration = (fork(d+1, i*2+0), fork(d+1, i*2+1))
    else:
      width = depth / 2
      iteration = iterate(i % width, i / width, 1000)
  return iteration


def iterate(x0, y0, max_iteration):
    # for each pixel (Px, Py) on the screen do
    #     x0 := scaled x coordinate of pixel (scaled to lie in the Mandelbrot X scale (-2.00, 0.47))
    #     y0 := scaled y coordinate of pixel (scaled to lie in the Mandelbrot Y scale (-1.12, 1.12))
    #     x := 0.0
    #     y := 0.0
    #     iteration := 0
    #     max_iteration := 1000
    #     while (x^2 + y^2 ≤ 2^2 AND iteration < max_iteration) do
    #         xtemp := x^2 - y^2 + x0
    #         y := 2*x*y + y0
    #         x := xtemp
    #         iteration := iteration + 1
  x = 0.0
  y = 0.0
  bend iteration = 0:
    when (x*x + y*y < 2*2 and iteration < max_iteration):
      xtemp = x*x - y*y + x0
      y = 2*x*y + y0
      x = xtemp
      iteration += 1
    return iteration

def main:
    return mandelbrot(16)