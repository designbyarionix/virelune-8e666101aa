export const defaults=Object.freeze({
  sv_jumpheight:600,sv_jumpheight_stamina_drain:5,sv_d_jumpheight:425,sv_d_jumpheight_stamina_drain:10,sv_w_jumpheight:500,
  sv_dash_speed:400,sv_dash_stamina_drain:3,sv_dodge_speed:900,sv_dodge_stamina_drain:120,
  sv_backflip_speed:450,sv_backflip_stamina_drain:15,sv_block_dmg_percent:.3,sv_block_stamina_drain:.03,
  sv_primary_dmg:3,sv_primary_knockback:500,sv_primary_swing_delay:.28,sv_swing_forward_move:175,
  sv_secondary_dmg:5,sv_secondary_knockback:700,sv_secondary_stamina_drain:5,
  sv_secondary_cooldown:1.5,sv_secondary_swing_delay:.3,sv_airmelee_primary_dmg:4,sv_airmelee_secondary_dmg:6,
  sv_airhit_knockback:650,sv_stun_time_airhit:1,sv_stun_time:.5,sv_final_swing_delay:5,
  sv_kunai_dmg:6,sv_kunai_speed:1300,sv_shuriken_dmg:2,sv_shuriken_speed:1800,sv_shuriken_spread:.06,
  sv_exploding_tag_dmg:22,sv_exploding_tag_dmg_radius:180,sv_katon_gouk_dmg:28,sv_katon_gouk_speed:1000,
  sv_katon_gouk_radius:200,sv_katon_gouk_chakra_consumption:3100,sv_katon_housenka_dmg:11,
  sv_katon_housenka_speed:1650,sv_katon_housenka_radius:100,sv_katon_housenka_chakra_consumption:1000,
  sv_kagebunshin_chakra_consumption:3900,sv_kagebunshin_dmg:3,sv_bunshin_chakra_consumption:150,
  sv_orioke_chakra_consumption:3000,sv_orioke_stun_time:2.5,sv_orioke_change_time:1.5,sv_orioke_knockback:320,sv_healing_chakra_consumption:850,
  sv_healing_recover_amount:5,sv_healing_recover_count:5,sv_healing_time:.6,
  sv_focus_strength_punch_chakra_consumption:35,sv_focus_strength_punch_damage:30,sv_focus_strength_kick_chakra_consumption:50,
  sv_pakkun_chakra_consumption:30,sv_pakkun_dmg:3,sv_pakkun_time_pakkunlives:17,
  sv_chidori_charge_time:.1,sv_chidori_charge_delay:1,sv_chidori_charge_chakra_consumption:1,
  sv_rasengan_charge_time:.15,sv_rasengan_charge_chakra_consumption:1.1,
  sv_stamina_recover_points:4,sv_stamina_recoverdelay:3,sv_chakra_convert_points:1.5,sv_target_range:1350,sv_target_memory:7
});
export function parseRules(text){
  const rules={...defaults};
  for(const line of text.split(/\r?\n/)){
    const row=line.trim().match(/^(sv_\w+)\s+"?(-?(?:\d+(?:\.\d*)?|\.\d+))"?(?:\s|$)/i);
    if(!row)continue;
    const key=row[1].toLowerCase(),value=Number(row[2]);
    if(Object.hasOwn(defaults,key)&&Number.isFinite(value)&&value>=0)rules[key]=value;
  }
  return rules;
}
export function strike(rules,{secondary,airborne,chain,guarded}){
  const damage=secondary
    ? airborne?rules.sv_airmelee_secondary_dmg:rules.sv_secondary_dmg
    : airborne?rules.sv_airmelee_primary_dmg:rules.sv_primary_dmg;
  const finisher=secondary||chain===5;
  return {
    damage:damage*(guarded?rules.sv_block_dmg_percent:1),
    knockback:guarded||!finisher?0:airborne?rules.sv_airhit_knockback:secondary?rules.sv_secondary_knockback:rules.sv_primary_knockback,
    stun:guarded?0:airborne?rules.sv_stun_time_airhit:rules.sv_stun_time
  };
}
