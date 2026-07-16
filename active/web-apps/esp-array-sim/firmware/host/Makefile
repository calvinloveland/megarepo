CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -I. -I../include

all: consume_example_test test_dsp

consume_example_test: consume_example.c consume_example_test.c esp_array_wire_example.h ../include/esp_array_protocol.h ../include/esp_array_frame.h
	$(CC) $(CFLAGS) consume_example.c consume_example_test.c -o $@

test_dsp: test_dsp.c ../main/esp_array_dsp.c ../include/esp_array_dsp.h
	$(CC) $(CFLAGS) -I../main test_dsp.c ../main/esp_array_dsp.c -lm -o $@

clean:
	rm -f consume_example_test test_dsp
