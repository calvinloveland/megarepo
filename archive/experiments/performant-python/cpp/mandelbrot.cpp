#include <complex>
#include <iostream>

int **generate_set()
{
    int x_min = -2;
    int x_max = 1;
    int y_min = -1;
    int y_max = 1;
    int width = 2000;
    int height = 2000;
    int max_iterations = 1000;

    double x_step = double(x_max - x_min) / double(width);
    double y_step = double(y_max - y_min) / double(height);

    int **mandelbrot_set = new int *[height];
    for (int i = 0; i < height; i++)
    {
        mandelbrot_set[i] = new int[width];
    }

    for (int y = 0; y < height; y++)
    {
        for (int x = 0; x < width; x++)
        {
            std::complex<double> c(x * x_step + x_min, y * y_step + y_min);
            std::complex<double> z(0.0, 0.0);
            int iteration = 0;

            while (std::abs(z) < 2 && iteration < max_iterations)
            {
                z = z * z + c;
                iteration++;
            }
            mandelbrot_set[y][x] = iteration;
        }
    }
    return mandelbrot_set;
}

int main(int argc, char *argv[])
{
    int **set = generate_set();
    std::cout << set[500][500] << std::endl;
    std::cout << set[1000][1000] << std::endl;
    std::cout << set[750][750] << std::endl;
    std::cout << set[751][750] << std::endl;
    return 0;
}