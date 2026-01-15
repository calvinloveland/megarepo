from django.conf.urls import url
from . import views

app_name = 'i3'

urlpatterns = [
    url(r'^$', views.index, name='index'),
    url(r'^wc/$', views.wc, name='wc'),
    url(r'^cockpit/$', views.cockpit, name='cockpit'),
    url(r'^engine/$', views.engine, name='engine'),
    url(r'^status/$', views.status, name='status'),
    url(r'^cooling_switch/$', views.cooling_switch, name='cooling_switch'),
    url(r'^set_gps/(?P<gps_coords>[0-9]+)/$', views.set_gps, name='set_gps'),
    url(r'^itinerary/$', views.itinerary, name='itinerary'),
    url(r'^ftl_on/$', views.ftl_on, name='ftl_on'),
    url(r'^pump_oxygen/$', views.pump_oxygen, name='pump_oxygen'),
    url(r'^move_fuel/$', views.move_fuel, name='move_fuel'),
    url(r'^enter_fuel/$', views.enter_fuel, name='enter_fuel'),
    url(r'^game_over/$', views.game_over, name='game_over'),
]