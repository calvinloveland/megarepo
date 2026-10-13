/*
 * Hybrid sync test: i2s_std for init (pins, clock, mode),
 * then bare lldesc DMA for each run with simultaneous TX/RX start.
 */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_sleep.h"
#include "driver/i2s_std.h"
#include "soc/i2s_struct.h"
#include "hal/i2s_ll.h"
#include "rom/lldesc.h"

#define I2S_NUM     0
#define BCK         26
#define WS          25
#define DOUT        22
#define DIN         23
#define SR          48000
#define DMA_LEN     510
#define CLICK_SAMP  96
#define RUNS        50

static i2s_dev_t *hw;
static i2s_chan_handle_t tx, rx;
static int16_t g_click[CLICK_SAMP];
static float   g_click_f[CLICK_SAMP];
static int16_t g_cap[DMA_LEN];
static int     g_off[RUNS];

static int16_t __attribute__((aligned(4))) g_tx[DMA_LEN * 2];
static int32_t __attribute__((aligned(4))) g_rx[DMA_LEN * 2];
static lldesc_t g_dtx, g_drx;

static void i2s_init(void) {
    i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM, I2S_ROLE_MASTER);
    i2s_new_channel(&cc, &tx, &rx);
    i2s_std_config_t sc = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SR),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = { .mclk = I2S_GPIO_UNUSED, .bclk = BCK, .ws = WS,
                      .dout = DOUT, .din = DIN, .invert_flags = {0} },
    };
    i2s_channel_init_std_mode(tx, &sc);
    i2s_channel_init_std_mode(rx, &sc);
    i2s_channel_enable(tx);
    i2s_channel_enable(rx);
    hw = I2S_LL_GET_HW(I2S_NUM);
}

static void click(void) {
    for (int i=0;i<CLICK_SAMP;i++) {
        float t=(float)i/SR, v=sinf(2.f*M_PI*2000.f*t)*150.f;
        int f=CLICK_SAMP/8; if(f<1)f=1;
        float e=1.f; if(i<f)e=(float)i/f; else if(i>=CLICK_SAMP-f)e=(float)(CLICK_SAMP-1-i)/f;
        g_click[i]=(int16_t)(v*e); g_click_f[i]=g_click[i];
    }
}

static void prep_tx(void) {
    memset(g_tx,0,sizeof(g_tx));
    for (int i=0;i<CLICK_SAMP;i++) g_tx[510+i*2]=g_tx[510+i*2+1]=g_click[i];
}

static void one_run(int idx) {
    /* Stop DMA engines */
    i2s_ll_tx_stop(hw); i2s_ll_rx_stop(hw);
    i2s_ll_tx_reset_dma(hw); i2s_ll_rx_reset_dma(hw);
    i2s_ll_tx_reset_fifo(hw); i2s_ll_rx_reset_fifo(hw);

    prep_tx(); memset(g_rx,0,sizeof(g_rx));

    g_dtx.size=sizeof(g_tx); g_dtx.length=sizeof(g_tx);
    g_dtx.buf=(const uint8_t*)g_tx; g_dtx.owner=1; g_dtx.eof=1;
    g_dtx.sosf=0; g_dtx.offset=0; g_dtx.empty=0;

    g_drx.size=sizeof(g_rx); g_drx.length=sizeof(g_rx);
    g_drx.buf=(const uint8_t*)g_rx; g_drx.owner=1; g_drx.eof=1;
    g_drx.sosf=0; g_drx.offset=0; g_drx.empty=0;

    i2s_ll_tx_start_link(hw,(uint32_t)&g_dtx);
    i2s_ll_rx_start_link(hw,(uint32_t)&g_drx);
    /* Atomic start: TX (bit4) + RX (bit5) in one write → same clock edge */
    hw->conf.val = hw->conf.val | 0x30;

    for (volatile int t=0; g_drx.owner && t<5000000; t++) {}
    for (volatile int t=0; g_dtx.owner && t<5000000; t++) {}

    for (int i=0;i<DMA_LEN;i++) g_cap[i]=(int16_t)((g_rx[i*2]>>8)>>8);

    float best=-1e30f; int bi=0;
    for (int o=0;o<DMA_LEN-CLICK_SAMP;o++) {
        float s=0; for (int k=0;k<CLICK_SAMP;k++) s+=(float)g_cap[o+k]*g_click_f[k];
        if(s>best){best=s;bi=o;}
    }
    g_off[idx]=bi;
}

static void stats(void) {
    double su=0,sq=0; int mn=999999,mx=-999999;
    for (int i=0;i<RUNS;i++){int v=g_off[i];su+=v;sq+=(double)v*v;if(v<mn)mn=v;if(v>mx)mx=v;}
    double m=su/RUNS,v=sq/RUNS-m*m;if(v<0)v=0;double s=sqrt(v);
    printf("\n=== Hybrid (std init + LL DMA) Sync ===\n");
    printf("%d runs | Mean: %.2f samp (%.4f ms) | Std: %.2f samp (%.4f ms)\n",RUNS,m,m/SR*1000,s,s/SR*1000);
    printf("Min: %d  Max: %d  Spread: %d (%.4f ms)\n",mn,mx,mx-mn,(double)(mx-mn)/SR*1000);
}

void app_main(void) {
    printf("\n===== Hybrid DMA Sync =====\n");
    i2s_init(); click();
    for (int r=0;r<RUNS;r++){printf("Run %02d...\n",r+1);one_run(r);}
    stats();
    i2s_channel_disable(tx); i2s_channel_disable(rx);
    i2s_del_channel(tx); i2s_del_channel(rx);
    printf("\nDone. Deep sleep...\n"); vTaskDelay(5000/portTICK_PERIOD_MS); esp_deep_sleep_start();
}
