# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import models
import random

Planets = ["648721","876194","846721","427619","465973","321678","976382","346197","276481","000000"]

# Create your models here.

class Ship(models.Model):

    planet = models.IntegerField(default=0)
    distance_to_planet = models.FloatField(default=10000)
    health = models.FloatField(default=1000)
    multiplier = models.FloatField(default=0.1)
    oxygen = models.FloatField(default=100)
    heat = models.FloatField(default=50)
    cooling = models.BooleanField(default=True)
    engine_fuel = models.FloatField(default=0)
    fuel = models.FloatField(default=100)
    current_shield = models.IntegerField(default=0)
    ideal_shield = models.IntegerField(default=0)
    shield_instability = models.FloatField(default=0)
    gps = models.CharField(max_length=6, default='000000')
    self_destruct = models.BooleanField(default=False)
    ftl_on = models.BooleanField(default=False)

    def update(self):
        health_loss = 1

        if self.oxygen > 0:
            self.oxygen -= self.multiplier
        else:
            self.health -= health_loss


        if self.fuel > 0 and self.ftl_on:
            self.fuel -= .5
        else:
            self.ftl_on = False

        if abs(self.heat) > 100:
            self.health -= health_loss
        if self.cooling:
            self.heat -= self.multiplier
        else:
            self.heat += self.multiplier


        if self.distance_to_planet < 1:
            self.planet += 1
            self.distance_to_planet = 10000
            self.multiplier *= 2
            self.health += 100

        if self.ftl_on:
            if self.gps == Planets[self.planet]:
                self.distance_to_planet -= 10 + random.randint(1,100)
            else:
                self.distance_to_planet += random.randint(-20,20)

        self.shield_instability += self.multiplier
        if random.randint(0,200) < self.shield_instability:
            self.ideal_shield = random.randint(5,95)
            self.shield_instability = 0

        if (self.current_shield + 10 > self.ideal_shield and self.current_shield - 10 < self.ideal_shield):
            self.health -= health_loss

    def switch_cooling(self):
        self.cooling = not self.cooling
