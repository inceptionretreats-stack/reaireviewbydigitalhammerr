import 'package:ai_review/app/router.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('website dashboard links open the matching app screen', () {
    expect(screenForWebPath('/app'), '/home');
    expect(screenForWebPath('/app/feedback'), '/feedback');
    expect(screenForWebPath('/app/review-requests'), '/customers');
    expect(screenForWebPath('/app/settings'), '/account');
    expect(screenForWebPath('/app/subscription/receipts/abc'), '/subscription');
    expect(screenForWebPath('/app/something-new'), '/home');
  });

  test('customer and business pages are not dashboard links', () {
    expect(screenForWebPath('/apple-bakery'), isNull);
    expect(screenForWebPath('/r/ABCDEFGHJK'), isNull);
    expect(screenForWebPath('/home'), isNull);
  });
}
