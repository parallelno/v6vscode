#include <stdint.h>

static volatile uint8_t sink;

static inline uint8_t add8(uint8_t a, uint8_t b) {
    uint8_t s = (uint8_t)(a + b);
    return s;
}

static uint8_t accumulate(uint8_t *data, uint8_t count) {
    uint8_t total = 0;
    for (uint8_t i = 0; i < count; ++i) {
        total = add8(total, data[i]);
    }
    return total;
}

void main(void) {
    uint8_t values[4] = { 1, 2, 3, 4 };
    uint8_t result = accumulate(values, 4);
    sink = result;
    for (;;) {
    }
}